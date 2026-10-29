/* BLESS app UI. Hash-routed single page app; all text from the shop is rendered as text (never as HTML).
   Prices always come from the server (quote / cart); nothing here calculates what a customer pays. */
( function () {
	'use strict';
	var API = window.BlessAPI, CONF = window.BLESS_CONFIG;
	var view = document.getElementById( 'view' );
	var cfg = null, tree = null, token = 0;

	/* ============================ helpers ============================ */
	function h( tag, attrs, kids ) {
		var n = document.createElement( tag );
		Object.keys( attrs || {} ).forEach( function ( k ) {
			var v = attrs[ k ];
			if ( v === null || v === undefined || v === false ) { return; }
			if ( k === 'text' ) { n.textContent = v; } else if ( k === 'class' ) { n.className = v; } else if ( k.slice( 0, 2 ) === 'on' ) { n.addEventListener( k.slice( 2 ), v ); } else { n.setAttribute( k, v === true ? '' : v ); }
		} );
		( kids || [] ).forEach( function ( c ) { if ( c !== null && c !== undefined && c !== false ) { n.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c ); } } );
		return n;
	}
	function clear( n ) { while ( n.firstChild ) { n.removeChild( n.firstChild ); } }
	function num( v ) { var n = parseFloat( v ); return isNaN( n ) ? 0 : n; }
	function money( v ) {
		var n = num( v ), cur = cfg && cfg.currency ? cfg.currency : 'Rs.';
		return cur + ' ' + ( n % 1 ? n.toFixed( 2 ) : n.toLocaleString( 'en-US' ) );
	}
	var mem = {};
	function sget( k ) { try { return window.localStorage.getItem( k ); } catch ( e ) { return mem[ k ] || null; } }
	function sset( k, v ) { try { window.localStorage.setItem( k, v ); } catch ( e ) { mem[ k ] = v; } }
	function jget( k, d ) { try { var v = JSON.parse( sget( k ) ); return v === null || v === undefined ? d : v; } catch ( e ) { return d; } }
	function slugify( s ) { return String( s ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' ); }

	function toast( msg ) {
		var t = document.getElementById( 'toast' ); t.textContent = msg; t.classList.add( 'show' );
		clearTimeout( toast._t ); toast._t = setTimeout( function () { t.classList.remove( 'show' ); }, 2400 );
	}
	function setCount( n ) {
		var b = document.getElementById( 'cart-count' ); n = parseInt( n, 10 ) || 0;
		var changed = b.textContent !== String( n );
		b.textContent = String( n ); b.hidden = n < 1;
		var tb = document.getElementById( 'tab-count' ); if ( tb ) { tb.textContent = String( n ); tb.hidden = n < 1; }
		if ( changed ) { b.classList.remove( 'bump' ); void b.offsetWidth; b.classList.add( 'bump' ); }
	}
	function openExternal( url ) {
		try { var B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser; if ( B && B.open ) { B.open( { url: url } ); return; } } catch ( e ) { /* fall through */ }
		window.open( url, '_blank', 'noopener' );
	}
	function extLink( url, text, cls ) {
		return h( 'a', { href: url, class: cls || '', text: text, onclick: function ( e ) { e.preventDefault(); openExternal( url ); } } );
	}
	function siteUrl( path ) { return String( ( cfg && cfg.site_url ) || CONF.SITE_URL ).replace( /\/+$/, '' ) + '/' + String( path || '' ).replace( /^\/+/, '' ); }

	/** A link that points at the shop's own website becomes a screen in the app. */
	function appRoute( url ) {
		if ( ! url ) { return '#/shop'; }
		var base = String( ( cfg && cfg.site_url ) || CONF.SITE_URL ).replace( /\/+$/, '' );
		if ( url.indexOf( base ) !== 0 ) { return /^https?:/i.test( url ) ? url : '#/shop'; }
		var p = url.slice( base.length ).replace( /[?#].*$/, '' ), m;
		if ( ( m = p.match( /^\/category\/([^/]+)/ ) ) ) { return '#/shop?cat=' + m[ 1 ]; }
		if ( ( m = p.match( /^\/product\/([^/]+)/ ) ) ) { return '#/product/' + m[ 1 ]; }
		if ( /^\/cart/.test( p ) ) { return '#/cart'; }
		return '#/shop';
	}
	function productSlug( url ) { var m = String( url || '' ).match( /\/product\/([^/?#]+)/ ); return m ? m[ 1 ] : ''; }

	function current( t ) { return t === token; }
	function skeletonGrid( n, cls ) {
		var g = h( 'div', { class: 'grid' + ( cls ? ' ' + cls : '' ) } );
		for ( var i = 0; i < n; i++ ) { g.appendChild( h( 'div', { class: 'pcard skel' }, [ h( 'div', { class: 'pimg' } ), h( 'div', { class: 'line' } ), h( 'div', { class: 'line short' } ) ] ) ); }
		return g;
	}
	function retryCard( msg, fn ) {
		return h( 'div', { class: 'empty' }, [ h( 'p', { text: msg } ), h( 'button', { class: 'btn btn-ghost', type: 'button', text: 'Try again', onclick: fn } ) ] );
	}
	function heading( text, linkHref, linkText ) {
		return h( 'div', { class: 'h-section' }, [ h( 'h2', { text: text } ), linkHref ? h( 'a', { href: linkHref, text: linkText || 'View all' } ) : null ] );
	}
	function ornament() { return h( 'img', { class: 'orn', src: 'assets/logo-flourish.svg', alt: '', 'aria-hidden': 'true' } ); }

	/* ============================ categories ============================ */
	function buildTree( list ) {
		var t = { by: {}, kids: {}, tops: [], occasions: [], collections: [] };
		list.forEach( function ( c ) {
			t.by[ c.slug ] = c;
			if ( c.parent ) { ( t.kids[ c.parent ] = t.kids[ c.parent ] || [] ).push( c ); }
			else if ( c.type === 'occasion' ) { t.occasions.push( c ); }
			else if ( c.type === 'collection' ) { t.collections.push( c ); }
			else { t.tops.push( c ); }
		} );
		return t;
	}
	function catCircle( c ) {
		var inner = c.image ? h( 'img', { src: c.image, alt: '', loading: 'lazy' } ) : h( 'span', { class: 'mono', text: c.name.charAt( 0 ) } );
		return h( 'a', { class: 'arch', href: '#/shop?cat=' + c.slug }, [ h( 'span', { class: 'arch-img' }, [ inner ] ), h( 'span', { class: 'arch-cap', text: c.name } ) ] );
	}

	/* ============================ product cards ============================ */
	function productCard( p, i ) {
		var onSale = p.was_price && num( p.was_price ) > num( p.price_from );
		var a = h( 'a', { class: 'pcard fade-up' + ( p.sold_out ? ' sold' : '' ), href: '#/product/' + p.slug }, [
			h( 'div', { class: 'pimg' }, [ p.image ? h( 'img', { src: p.image, alt: p.name, loading: 'lazy' } ) : h( 'img', { class: 'ph', src: 'assets/bless-emblem.png', alt: '' } ), onSale ? h( 'span', { class: 'tag', text: 'Sale' } ) : null, p.sold_out ? h( 'span', { class: 'tag dark', text: 'Sold out' } ) : null, p.sold_out ? null : h( 'span', { class: 'padd', 'aria-hidden': 'true', text: '+' } ) ] ),
			h( 'div', { class: 'pmeta' }, [ h( 'h3', { text: p.name } ), h( 'p', { class: 'pprice' }, [ ( p.has_range ? 'From ' : '' ) + money( p.price_from ), onSale ? h( 'del', { text: money( p.was_price ) } ) : null ] ) ] )
		] );
		a.style.animationDelay = Math.min( ( i || 0 ) * 50, 400 ) + 'ms';
		return a;
	}
	function grid( items ) { var g = h( 'div', { class: 'grid' } ); items.forEach( function ( p, i ) { g.appendChild( productCard( p, i ) ); } ); return g; }
	function productSection( t, title, params, href, cls ) {
		var box = h( 'section', {}, [ heading( title, href ) ] ), holder = h( 'div' );
		holder.appendChild( skeletonGrid( 4 ) ); box.appendChild( holder );
		function load() {
			API.products( params ).then( function ( r ) {
				if ( ! current( t ) ) { return; }
				clear( holder );
				if ( ! r.items.length ) { box.hidden = true; return; }
				var g = grid( r.items ); if ( cls ) { g.classList.add( cls ); } holder.appendChild( g );
			} ).catch( function () { if ( current( t ) ) { clear( holder ); holder.appendChild( retryCard( 'Could not load products.', function () { clear( holder ); holder.appendChild( skeletonGrid( 4 ) ); load(); } ) ); } } );
		}
		load();
		return box;
	}

	/* ============================ screens ============================ */
	function home( t ) {
		setTab( 'home' );
		var wrap = h( 'div', { class: 'screen home' } );
		var sf = h( 'form', { class: 'home-search', role: 'search' }, [ icon( 'search' ), h( 'input', { type: 'search', placeholder: 'Search cakes, flowers, gifts', 'aria-label': 'Search products', enterkeyhint: 'search' } ) ] );
		sf.addEventListener( 'submit', function ( e ) { e.preventDefault(); var v = sf.querySelector( 'input' ).value.trim(); location.hash = '#/shop' + ( v ? '?q=' + encodeURIComponent( v ) : '' ); } );
		wrap.appendChild( h( 'section', { class: 'hhead' }, [ h( 'p', { class: 'hello', text: 'Assalam o Alaikum' } ), h( 'h1', { text: 'What are you gifting today?' } ), sf ] ) );
		var slides = cfg.hero || [];
		if ( slides.length ) {
			var track = h( 'div', { class: 'hero-track' } ), dots = h( 'div', { class: 'dots' } );
			slides.forEach( function ( s, i ) {
				var href = appRoute( s.link ), ext = /^https?:/i.test( href );
				var a = h( 'a', { class: 'slide', href: href }, [ h( 'img', { src: s.image, alt: '', loading: i ? 'lazy' : 'eager' } ), h( 'div', { class: 'veil' } ),
					h( 'div', { class: 'slide-text' }, [ s.subtitle ? h( 'p', { class: 'eyebrow', text: s.subtitle } ) : null, h( 'h2', { text: s.title } ), s.cta ? h( 'span', { class: 'btn btn-gold', text: s.cta } ) : null ] ) ] );
				if ( ext ) { a.addEventListener( 'click', function ( e ) { e.preventDefault(); openExternal( href ); } ); }
				track.appendChild( a ); dots.appendChild( h( 'i', { class: i ? '' : 'on' } ) );
			} );
			wrap.appendChild( h( 'section', { class: 'hero' }, [ track, slides.length > 1 ? dots : null ] ) );
			var idx = 0, n = slides.length, paused = false;
			track.addEventListener( 'scroll', function () { idx = Math.round( track.scrollLeft / track.clientWidth ); Array.prototype.forEach.call( dots.children, function ( d, k ) { d.className = k === idx ? 'on' : ''; } ); } );
			track.addEventListener( 'touchstart', function () { paused = true; }, { passive: true } );
			if ( n > 1 ) {
				var tm = setInterval( function () {
					if ( ! document.body.contains( track ) ) { clearInterval( tm ); return; }
					if ( paused ) { paused = false; return; }
					track.scrollTo( { left: track.clientWidth * ( ( idx + 1 ) % n ), behavior: 'smooth' } );
				}, Math.max( 3000, cfg.hero_autoplay_ms || 6000 ) );
			}
		}
		if ( tree.tops.length ) {
			var row = h( 'div', { class: 'arches' } ); tree.tops.forEach( function ( c, n ) { var a = catCircle( c ); a.style.setProperty( '--i', Math.min( n, 9 ) ); row.appendChild( a ); } );
			wrap.appendChild( h( 'section', { class: 'sec' }, [ heading( 'Shop by category', '#/browse', 'See all' ), row ] ) );
		}
		if ( tree.occasions.length ) {
			var chips = h( 'div', { class: 'chips scroll' } ); tree.occasions.forEach( function ( c ) { chips.appendChild( h( 'a', { class: 'chip', href: '#/shop?cat=' + c.slug, text: c.name } ) ); } );
			wrap.appendChild( h( 'section', { class: 'sec' }, [ heading( 'Shop by occasion' ), chips ] ) );
		}
		wrap.appendChild( productSection( t, 'Best sellers', { featured: 1, per_page: 8 }, '#/shop?sort=featured', 'hrow' ) );
		var lazy = ( 'IntersectionObserver' in window ) ? new IntersectionObserver( function ( es ) { es.forEach( function ( e ) { if ( e.isIntersecting ) { lazy.unobserve( e.target ); e.target._go(); } } ); }, { rootMargin: '400px 0px' } ) : null;
		tree.tops.forEach( function ( c ) {
			var href = '#/shop?cat=' + c.slug, sec = h( 'section', { class: 'cat-sec' }, [ heading( c.name, href, 'View all' ) ] ), holder = h( 'div' ), loaded = false;
			holder.appendChild( skeletonGrid( 4, 'hrow' ) ); sec.appendChild( holder );
			sec._go = function () {
				if ( loaded ) { return; } loaded = true;
				API.products( { cat: c.slug, per_page: 8 } ).then( function ( r ) {
					if ( ! current( t ) ) { return; }
					if ( ! r.items.length ) { sec.hidden = true; return; }
					clear( holder ); var g = grid( r.items ); g.classList.add( 'hrow' );
					g.appendChild( h( 'a', { class: 'seeall', href: href }, [ h( 'span', { class: 'go', text: '›' } ), h( 'b', { text: 'View all' } ), h( 'small', { text: c.name } ) ] ) );
					holder.appendChild( g );
				} ).catch( function () { loaded = false; if ( current( t ) ) { clear( holder ); holder.appendChild( retryCard( 'Could not load ' + c.name + '.', function () { clear( holder ); holder.appendChild( skeletonGrid( 4, 'hrow' ) ); sec._go(); } ) ); } } );
			};
			wrap.appendChild( sec ); if ( lazy ) { lazy.observe( sec ); } else { sec._go(); }
		} );
		wrap.appendChild( h( 'div', { class: 'promise' }, [ promise( 'Made fresh', 'Baked for your date' ), promise( 'Gift ready', 'Cards and wrapping' ), promise( 'Your choice', 'Pick the day and slot' ) ] ) );
		wrap.appendChild( contactCard() );
		return wrap;
	}
	function promise( a, b ) { return h( 'div', {}, [ h( 'b', { text: a } ), h( 'span', { text: b } ) ] ); }
	function contactCard() {
		var s = cfg.shop || {}, btns = h( 'div', { class: 'contact-btns' } );
		if ( s.whatsapp ) { btns.appendChild( extLink( 'https://wa.me/' + String( s.whatsapp ).replace( /\D+/g, '' ), 'WhatsApp us', 'btn btn-gold' ) ); }
		if ( s.phone ) { btns.appendChild( h( 'a', { class: 'btn btn-ghost-light', href: 'tel:' + String( s.phone ).replace( /[^\d+]/g, '' ), text: 'Call ' + s.phone } ) ); }
		return h( 'section', { class: 'contact' }, [ h( 'img', { src: 'assets/bless-emblem.png', alt: '' } ), h( 'h2', { text: s.name || 'BLESS' } ), h( 'p', { text: s.address || 'Custom cakes, gifts, chocolates & flowers' } ), btns ] );
	}

	function browse( t ) {
		setTab( 'browse' );
		var wrap = h( 'div', { class: 'screen' } );
		wrap.appendChild( h( 'div', { class: 'page-title' }, [ h( 'h1', { text: 'Browse' } ), ornament() ] ) );
		if ( tree.collections.length ) {
			var col = h( 'div', { class: 'collections' } );
			tree.collections.forEach( function ( c ) { col.appendChild( h( 'a', { href: '#/shop?cat=' + c.slug }, [ h( 'span', { text: c.name } ) ] ) ); } );
			wrap.appendChild( col );
		}
		var acc = h( 'div', { class: 'acc' } );
		tree.tops.forEach( function ( c ) {
			var kids = tree.kids[ c.slug ] || [];
			var body = h( 'div', { class: 'acc-body' }, [ h( 'a', { href: '#/shop?cat=' + c.slug, text: 'All ' + c.name } ) ].concat( kids.map( function ( k ) { return h( 'a', { href: '#/shop?cat=' + k.slug, text: k.name } ); } ) ) );
			if ( ! kids.length ) { acc.appendChild( h( 'a', { class: 'acc-row link', href: '#/shop?cat=' + c.slug }, [ h( 'span', { text: c.name } ), h( 'i', { text: '›' } ) ] ) ); return; }
			var head = h( 'button', { class: 'acc-row', type: 'button', 'aria-expanded': 'false' }, [ h( 'span', { text: c.name } ), h( 'i', { text: '+' } ) ] );
			head.addEventListener( 'click', function () { var open = acc.contains( body ) && body.classList.toggle( 'open' ); head.setAttribute( 'aria-expanded', open ? 'true' : 'false' ); head.lastChild.textContent = open ? '–' : '+'; } );
			acc.appendChild( h( 'div', { class: 'acc-item' }, [ head, body ] ) );
		} );
		wrap.appendChild( acc );
		if ( tree.occasions.length ) {
			wrap.appendChild( heading( 'Occasions' ) );
			var chips = h( 'div', { class: 'chips wrap' } ); tree.occasions.forEach( function ( c ) { chips.appendChild( h( 'a', { class: 'chip', href: '#/shop?cat=' + c.slug, text: c.name } ) ); } ); wrap.appendChild( chips );
		}
		return wrap;
	}

	function shop( t, q ) {
		setTab( 'browse' );
		var cat = q.cat && tree.by[ q.cat ] ? tree.by[ q.cat ] : null, term = q.q || '', sort = q.sort || '';
		var wrap = h( 'div', { class: 'screen' } );
		wrap.appendChild( h( 'div', { class: 'page-title' }, [ h( 'h1', { text: cat ? cat.name : ( sort === 'newest' ? 'New arrivals' : 'Shop' ) } ), ornament() ] ) );
		var search = h( 'input', { type: 'search', class: 'search', placeholder: 'Search cakes, flowers, gifts…', value: term, 'aria-label': 'Search products', enterkeyhint: 'search' } );
		wrap.appendChild( search );
		var chips = h( 'div', { class: 'chips scroll' } ), parent = cat && cat.parent ? tree.by[ cat.parent ] : cat;
		var siblings = parent ? ( tree.kids[ parent.slug ] || [] ) : [];
		if ( parent && siblings.length ) {
			chips.appendChild( h( 'a', { class: 'chip' + ( cat === parent ? ' on' : '' ), href: '#/shop?cat=' + parent.slug, text: 'All ' + parent.name } ) );
			siblings.forEach( function ( c ) { chips.appendChild( h( 'a', { class: 'chip' + ( cat === c ? ' on' : '' ), href: '#/shop?cat=' + c.slug, text: c.name } ) ); } );
		} else if ( ! cat ) {
			chips.appendChild( h( 'a', { class: 'chip on', href: '#/shop', text: 'All' } ) );
			tree.collections.concat( tree.tops ).forEach( function ( c ) { chips.appendChild( h( 'a', { class: 'chip', href: '#/shop?cat=' + c.slug, text: c.name } ) ); } );
		}
		if ( chips.children.length ) { wrap.appendChild( chips ); }
		var sortSel = h( 'select', { class: 'sort', 'aria-label': 'Sort products' }, [ [ '', 'Recommended' ], [ 'newest', 'Newest' ], [ 'price_asc', 'Price: low to high' ], [ 'price_desc', 'Price: high to low' ], [ 'name', 'Name' ] ].map( function ( o ) { return h( 'option', { value: o[ 0 ], text: o[ 1 ] } ); } ) );
		sortSel.value = [ 'newest', 'price_asc', 'price_desc', 'name' ].indexOf( sort ) > -1 ? sort : '';
		var count = h( 'span', { class: 'count' } );
		wrap.appendChild( h( 'div', { class: 'toolbar' }, [ count, sortSel ] ) );
		var holder = h( 'div' ), more = h( 'div', { class: 'more' } );
		wrap.appendChild( holder ); wrap.appendChild( more );
		var page = 1, seq = 0;
		function params( pg ) { return { cat: cat ? cat.slug : '', q: search.value.trim(), orderby: sortSel.value, page: pg, per_page: 12 }; }
		function load( reset ) {
			var mine = ++seq;
			if ( reset ) { page = 1; clear( holder ); clear( more ); holder.appendChild( skeletonGrid( 4 ) ); }
			API.products( params( page ) ).then( function ( r ) {
				if ( ! current( t ) || mine !== seq ) { return; }
				if ( reset ) { clear( holder ); }
				count.textContent = r.total + ( r.total === 1 ? ' product' : ' products' );
				clear( more );
				if ( ! r.items.length && reset ) { holder.appendChild( h( 'div', { class: 'empty' }, [ h( 'img', { src: 'assets/floral-sprig.svg', alt: '' } ), h( 'p', { text: 'Nothing found. Try another search or category.' } ) ] ) ); return; }
				var g = holder.querySelector( '.grid' ); if ( ! g ) { g = h( 'div', { class: 'grid' } ); holder.appendChild( g ); }
				r.items.forEach( function ( p, i ) { g.appendChild( productCard( p, i ) ); } );
				if ( r.page < r.pages ) { more.appendChild( h( 'button', { class: 'btn btn-ghost', type: 'button', text: 'Show more', onclick: function () { page = r.page + 1; load( false ); } } ) ); }
			} ).catch( function () { if ( current( t ) && mine === seq ) { clear( holder ); holder.appendChild( retryCard( 'Could not load products.', function () { load( true ); } ) ); } } );
		}
		var timer = null;
		search.addEventListener( 'input', function () { clearTimeout( timer ); timer = setTimeout( function () { load( true ); }, 350 ); } );
		sortSel.addEventListener( 'change', function () { load( true ); } );
		load( true );
		return wrap;
	}

	/* ---------- product ---------- */
	var SWATCHES = [ '#6f1728', '#b98282', '#c9a66b', '#f4dcdc', '#1e1b19', '#ffffff', '#2f5d50', '#1f3a5f' ];

	function product( t, slug ) {
		setTab( 'browse' );
		var wrap = h( 'div', { class: 'screen' } ); wrap.appendChild( h( 'div', { class: 'pdp-skel' } ) );
		API.product( slug ).then( function ( p ) {
			if ( ! current( t ) ) { return; }
			clear( wrap );
			if ( ! p ) { wrap.appendChild( h( 'div', { class: 'empty' }, [ h( 'img', { src: 'assets/floral-sprig.svg', alt: '' } ), h( 'p', { text: 'This product is no longer available.' } ), h( 'a', { class: 'btn btn-primary', href: '#/shop', text: 'Back to shop' } ) ] ) ); return; }
			buildProduct( wrap, p );
		} ).catch( function () { if ( current( t ) ) { clear( wrap ); wrap.appendChild( retryCard( 'Could not load this product.', function () { route(); } ) ); } } );
		return wrap;
	}

	function buildProduct( wrap, p ) {
		var attrs = {}, opts = {}, qty = 1, attempted = false, seq = 0, timer = null, last = null, uploading = 0;
		var hasVars = p.variations && p.variations.length, attrNames = Object.keys( p.attributes || {} );
		var soldOut = p.availability === 'out_of_stock';

		/* gallery */
		var track = h( 'div', { class: 'gtrack' } ), dots = h( 'div', { class: 'dots light' } );
		function paintGallery( list, focus ) {
			clear( track ); clear( dots );
			( list.length ? list : [ '' ] ).forEach( function ( src, i ) {
				track.appendChild( h( 'div', { class: 'gslide' }, [ src ? h( 'img', { src: src, alt: p.name } ) : h( 'img', { class: 'ph', src: 'assets/bless-emblem.png', alt: '' } ) ] ) );
				if ( list.length > 1 ) { dots.appendChild( h( 'i', { class: i === ( focus || 0 ) ? 'on' : '' } ) ); }
			} );
			track.scrollLeft = ( focus || 0 ) * track.clientWidth;
		}
		track.addEventListener( 'scroll', function () { var i = Math.round( track.scrollLeft / Math.max( 1, track.clientWidth ) ); Array.prototype.forEach.call( dots.children, function ( d, k ) { d.className = k === i ? 'on' : ''; } ); } );
		paintGallery( p.images || [], 0 );
		var shareBtn = h( 'button', { class: 'iconbtn float right', type: 'button', 'aria-label': 'Share', onclick: function () {
			var url = siteUrl( 'product/' + p.slug + '/' );
			if ( navigator.share ) { navigator.share( { title: p.name, url: url } ).catch( function () {} ); } else if ( navigator.clipboard ) { navigator.clipboard.writeText( url ).then( function () { toast( 'Link copied' ); } ); }
		} }, [ icon( 'share' ) ] );
		wrap.appendChild( h( 'div', { class: 'gallery' }, [ track, h( 'button', { class: 'iconbtn float', type: 'button', 'aria-label': 'Back', onclick: goBack }, [ icon( 'back' ) ] ), shareBtn, dots ] ) );

		var priceEl = h( 'div', { class: 'pdp-price' } ), errEl = h( 'p', { class: 'err', role: 'alert' } );
		var totalEl = h( 'b', { text: money( p.base_price ) } );
		var addBtn = h( 'button', { class: 'btn btn-primary grow', type: 'button', text: soldOut ? 'Sold out' : 'Add to cart', disabled: soldOut } );
		var form = h( 'div', { class: 'config' } );

		/* attribute pills */
		function minVar() { return Math.min.apply( null, p.variations.map( function ( v ) { return num( v.price ); } ) ); }
		function availableValue( name, value ) {
			var cand = p.variations.filter( function ( v ) { return attrNames.every( function ( n ) { return n === name || ! attrs[ n ] || String( v.attributes[ n ] ).toLowerCase() === String( attrs[ n ] ).toLowerCase(); } ); } );
			return cand.some( function ( v ) { return String( v.attributes[ name ] ).toLowerCase() === String( value ).toLowerCase() && v.in_stock !== false; } );
		}
		var pillGroups = {};
		attrNames.forEach( function ( name ) {
			var grp = h( 'div', { class: 'pills', role: 'radiogroup', 'aria-label': name } ); pillGroups[ name ] = grp;
			p.attributes[ name ].forEach( function ( v ) {
				var b = h( 'button', { type: 'button', class: 'pill', role: 'radio', 'aria-checked': 'false', text: v } );
				b.addEventListener( 'click', function () { attrs[ name ] = v; refreshPills(); onChange(); } );
				grp.appendChild( b );
			} );
			form.appendChild( h( 'div', { class: 'field', 'data-block': 'v' }, [ h( 'label', { class: 'lab', text: name + ' *' } ), grp, h( 'small', { class: 'err', 'data-err': 'v', role: 'alert' } ) ] ) );
		} );
		function refreshPills() {
			attrNames.forEach( function ( name ) {
				Array.prototype.forEach.call( pillGroups[ name ].children, function ( b ) {
					var v = b.textContent, on = String( attrs[ name ] || '' ).toLowerCase() === v.toLowerCase(), ok = availableValue( name, v );
					b.classList.toggle( 'on', on ); b.setAttribute( 'aria-checked', on ? 'true' : 'false' ); b.classList.toggle( 'off', ! ok ); b.title = ok ? '' : 'Out of stock';
				} );
			} );
			var hit = hasVars && attrNames.every( function ( n ) { return attrs[ n ]; } ) ? p.variations.filter( function ( v ) { return attrNames.every( function ( n ) { return String( v.attributes[ n ] ).toLowerCase() === String( attrs[ n ] ).toLowerCase(); } ); } )[ 0 ] : null;
			if ( hit && hit.image ) { paintGallery( [ hit.image ].concat( ( p.images || [] ).filter( function ( x ) { return x !== hit.image; } ) ), 0 ); }
		}

		/* option fields */
		function setOpt( key, v ) { if ( v === '' || v === null || v === undefined || v === false ) { delete opts[ key ]; } else { opts[ key ] = String( v ); } onChange(); }
		function extra( o ) { return num( o.extra ) > 0 ? ' (+' + money( o.extra ) + ')' : ''; }
		( p.options || [] ).forEach( function ( o ) { form.appendChild( optionField( o ) ); } );

		function optionField( o ) {
			var f = h( 'div', { class: 'field' } ), id = 'o-' + o.key, lab = o.label + ( o.required ? ' *' : '' ), ctl;
			if ( o.type === 'select' ) {
				ctl = h( 'select', { id: id }, [ h( 'option', { value: '', text: 'Choose…' } ) ].concat( o.choices.map( function ( c ) { return h( 'option', { value: c.value, text: c.label + extra( c ) } ); } ) ) );
				ctl.addEventListener( 'change', function () { setOpt( o.key, ctl.value ); } );
				f.appendChild( h( 'label', { class: 'lab', for: id, text: lab } ) ); f.appendChild( ctl );
			} else if ( o.type === 'radio' ) {
				var g = h( 'div', { class: 'radios', role: 'radiogroup', 'aria-label': o.label } );
				o.choices.forEach( function ( c, i ) {
					var r = h( 'input', { type: 'radio', name: id, id: id + i, value: c.value } );
					r.addEventListener( 'change', function () { setOpt( o.key, c.value ); } );
					g.appendChild( h( 'label', { class: 'radio', for: id + i }, [ r, h( 'span', { text: c.label + extra( c ) } ) ] ) );
				} );
				f.appendChild( h( 'label', { class: 'lab', text: lab } ) ); f.appendChild( g );
			} else if ( o.type === 'checkbox' ) {
				ctl = h( 'input', { type: 'checkbox', id: id } );
				ctl.addEventListener( 'change', function () { setOpt( o.key, ctl.checked ? '1' : '' ); } );
				f.appendChild( h( 'label', { class: 'switch', for: id }, [ ctl, h( 'i' ), h( 'span', { text: lab + extra( o ) } ) ] ) );
			} else if ( o.type === 'text' || o.type === 'textarea' ) {
				var max = o.max || ( o.type === 'text' ? 120 : 500 ), cnt = h( 'small', { class: 'counter', text: '0/' + max } );
				ctl = o.type === 'text' ? h( 'input', { type: 'text', id: id, maxlength: String( max ), autocomplete: 'off' } ) : h( 'textarea', { id: id, rows: '3', maxlength: String( max ) } );
				ctl.addEventListener( 'input', function () { cnt.textContent = ctl.value.length + '/' + max; setOpt( o.key, ctl.value ); } );
				f.appendChild( h( 'label', { class: 'lab', for: id, text: lab + extra( o ) } ) ); f.appendChild( ctl ); f.appendChild( cnt );
			} else if ( o.type === 'color' ) {
				var sw = h( 'div', { class: 'swatches', role: 'radiogroup', 'aria-label': o.label } ), picker = h( 'input', { type: 'color', value: '#6f1728', 'aria-label': 'Custom colour' } );
				function pick( hex ) { Array.prototype.forEach.call( sw.querySelectorAll( 'button' ), function ( b ) { b.classList.toggle( 'on', b.getAttribute( 'data-hex' ) === hex ); } ); setOpt( o.key, hex ); }
				sw.appendChild( h( 'button', { type: 'button', class: 'swatch none on', 'data-hex': '', 'aria-label': 'No preference', text: 'None', onclick: function () { pick( '' ); } } ) );
				SWATCHES.forEach( function ( hx ) { var b = h( 'button', { type: 'button', class: 'swatch', 'data-hex': hx, 'aria-label': hx } ); b.style.background = hx; b.addEventListener( 'click', function () { pick( hx ); } ); sw.appendChild( b ); } );
				picker.addEventListener( 'input', function () { pick( picker.value.toLowerCase() ); } );
				sw.appendChild( picker );
				f.appendChild( h( 'label', { class: 'lab', text: lab + extra( o ) } ) ); f.appendChild( sw );
			} else if ( o.type === 'image_upload' ) {
				var st = h( 'small', { class: 'upload-status' } ), prev = h( 'img', { class: 'upload-prev', alt: '', hidden: true } ), rm = h( 'button', { type: 'button', class: 'link-btn', text: 'Remove', hidden: true } );
				ctl = h( 'input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: id, class: 'file' } );
				ctl.addEventListener( 'change', function () {
					delete opts[ o.key ]; onChange();
					var file = ctl.files && ctl.files[ 0 ]; prev.hidden = true; rm.hidden = true; st.textContent = '';
					if ( ! file ) { return; }
					if ( file.size > 5 * 1024 * 1024 ) { ctl.value = ''; st.textContent = 'Please choose an image under 5 MB.'; st.className = 'upload-status bad'; return; }
					prev.src = URL.createObjectURL( file ); prev.hidden = false; st.className = 'upload-status'; st.textContent = 'Uploading…'; uploading++; addBtn.disabled = true;
					API.upload( file ).then( function ( r ) {
						if ( r.ok && r.data && r.data.id ) { opts[ o.key ] = String( r.data.id ); st.textContent = 'Photo added ✓'; rm.hidden = false; }
						else { ctl.value = ''; prev.hidden = true; st.className = 'upload-status bad'; st.textContent = ( r.data && r.data.message ) || 'Upload failed. Please try again.'; }
					} ).catch( function () { ctl.value = ''; prev.hidden = true; st.className = 'upload-status bad'; st.textContent = 'Upload failed. Please check your connection.'; } ).then( function () { uploading--; addBtn.disabled = soldOut || uploading > 0; onChange(); } );
				} );
				rm.addEventListener( 'click', function () { ctl.value = ''; delete opts[ o.key ]; prev.hidden = true; rm.hidden = true; st.textContent = ''; onChange(); } );
				f.appendChild( h( 'label', { class: 'lab', for: id, text: lab + extra( o ) } ) );
				f.appendChild( h( 'div', { class: 'upload' }, [ ctl, prev, h( 'div', {}, [ st, rm ] ) ] ) );
			}
			f.appendChild( h( 'small', { class: 'err', 'data-err': 'o:' + o.key, role: 'alert' } ) );
			return f;
		}

		/* quantity */
		var qtyVal = h( 'span', { class: 'qty-val', text: '1', 'aria-live': 'polite' } );
		function setQty( n ) { qty = Math.max( 1, Math.min( 20, n ) ); qtyVal.textContent = String( qty ); onChange(); }
		var qtyBox = h( 'div', { class: 'qty' }, [ h( 'button', { type: 'button', 'aria-label': 'Fewer', text: '−', onclick: function () { setQty( qty - 1 ); } } ), qtyVal, h( 'button', { type: 'button', 'aria-label': 'More', text: '+', onclick: function () { setQty( qty + 1 ); } } ) ] );

		/* pricing + errors (server decides) */
		function paint( q ) {
			wrap.querySelectorAll( '[data-err]' ).forEach( function ( e ) { e.textContent = ''; } ); errEl.textContent = '';
			var general = [];
			if ( q && ! q.ok ) {
				q.errors.forEach( function ( e ) {
					var key = e.field === 'variation' ? 'v' : ( e.field === 'qty' || e.field === 'product' ) ? '' : 'o:' + e.field;
					var always = e.field === 'qty' || e.field === 'product';
					if ( ! attempted && ! always ) { return; }
					var slot = key ? wrap.querySelector( '[data-err="' + key + '"]' ) : null;
					if ( slot && ! slot.textContent ) { slot.textContent = e.message; } else if ( ! slot ) { general.push( e.message ); }
				} );
			}
			errEl.textContent = general.join( ' ' );
			if ( q && q.ok ) { priceEl.textContent = ''; priceEl.appendChild( document.createTextNode( money( q.unit_price ) ) ); if ( ! hasVars && num( p.regular_price ) > num( p.base_price ) && ! Object.keys( opts ).length ) { priceEl.appendChild( h( 'del', { text: money( p.regular_price ) } ) ); } totalEl.textContent = money( q.line_total ); }
			else { priceEl.textContent = hasVars && ! attrNames.every( function ( n ) { return attrs[ n ]; } ) ? 'From ' + money( minVar() ) : money( q ? q.unit_price : p.base_price ); totalEl.textContent = q ? money( q.line_total ) : money( p.base_price ); }
		}
		function body() { return { product_id: p.id, attributes: attrs, options: opts, qty: qty }; }
		function quote() {
			var mine = ++seq;
			API.quote( body() ).then( function ( q ) { if ( mine !== seq ) { return; } last = q; paint( q ); } ).catch( function () { if ( mine === seq ) { errEl.textContent = 'Could not check the price. Please check your connection.'; } } );
		}
		function onChange() { clearTimeout( timer ); timer = setTimeout( quote, 220 ); }

		addBtn.addEventListener( 'click', function () {
			attempted = true;
			if ( last && ! last.ok ) { paint( last ); var first = wrap.querySelector( '.err:not(:empty)' ); if ( first ) { first.scrollIntoView( { block: 'center', behavior: 'smooth' } ); } return; }
			addBtn.disabled = true; addBtn.textContent = 'Adding…';
			API.cartAdd( body() ).then( function ( r ) {
				addBtn.textContent = 'Add to cart'; addBtn.disabled = soldOut;
				if ( r.ok && r.data ) {
					setCount( r.data.count ); toast( 'Added to your cart' ); addBtn.classList.add( 'done' ); setTimeout( function () { addBtn.classList.remove( 'done' ); }, 900 );
					API.cart().then( function ( c ) { if ( c.count < r.data.count ) { cookieWarning(); } } ).catch( function () {} );
				} else {
					var errs = ( r.data && r.data.errors ) || [ { field: 'cart', message: 'Could not add to cart. Please try again.' } ];
					paint( { ok: false, errors: errs, unit_price: p.base_price, line_total: p.base_price } );
					if ( ! errEl.textContent && errs[ 0 ] ) { errEl.textContent = errs[ 0 ].message; }
				}
			} ).catch( function () { addBtn.textContent = 'Add to cart'; addBtn.disabled = soldOut; errEl.textContent = 'Could not add to cart. Please check your connection.'; } );
		} );

		var desc = h( 'div', { class: 'desc' } );
		String( p.description || p.short || '' ).split( /\n{2,}/ ).forEach( function ( para ) { if ( para.trim() ) { desc.appendChild( h( 'p', { text: para.trim() } ) ); } } );
		var avail = p.availability === 'made_to_order' ? 'Made fresh to order' : ( p.availability === 'out_of_stock' ? 'Currently sold out' : '' );
		wrap.appendChild( h( 'div', { class: 'sheet' }, [
			h( 'h1', { class: 'pdp-title', text: p.name } ), priceEl, avail ? h( 'p', { class: 'avail' + ( soldOut ? ' bad' : '' ), text: avail } ) : null, desc, form,
			h( 'div', { class: 'field' }, [ h( 'label', { class: 'lab', text: 'Quantity' } ), qtyBox ] ), errEl,
			h( 'div', { class: 'buybar' }, [ h( 'div', { class: 'total' }, [ h( 'small', { text: 'Total' } ), totalEl ] ), addBtn ] )
		] ) );
		refreshPills(); quote();
	}

	/* ---------- cart ---------- */
	function totalsBox( c ) {
		var box = h( 'div', { class: 'totals' } );
		function row( a, b, cls ) { box.appendChild( h( 'div', { class: cls || '' }, [ h( 'span', { text: a } ), h( 'span', { text: b } ) ] ) ); }
		row( 'Subtotal', money( c.subtotal ) );
		if ( num( c.discount ) > 0 ) { row( 'Discount' + ( c.coupon_code ? ' (' + c.coupon_code + ')' : '' ), '− ' + money( c.discount ), 'good' ); }
		row( c.delivery_method === 'pickup' ? 'Pickup' : 'Delivery', num( c.delivery_fee ) > 0 ? money( c.delivery_fee ) : 'Free' );
		row( 'Total', money( c.total ), 'grand' );
		return box;
	}
	function lineDetails( l ) {
		var box = h( 'div', { class: 'ldetails' } );
		Object.keys( l.variation || {} ).forEach( function ( k ) { box.appendChild( h( 'small', { text: k + ': ' + l.variation[ k ] } ) ); } );
		( l.options || [] ).forEach( function ( o ) { box.appendChild( h( 'small', { text: o.label + ': ' + o.value + ( num( o.price ) > 0 ? ' (+' + money( o.price ) + ')' : '' ) } ) ); } );
		return box;
	}

	function cartScreen( t ) {
		setTab( 'cart' );
		var wrap = h( 'div', { class: 'screen' } ), out = h( 'div' ), msg = h( 'p', { class: 'err center', role: 'alert' } );
		wrap.appendChild( h( 'div', { class: 'page-title' }, [ h( 'h1', { text: 'Your cart' } ), ornament() ] ) ); wrap.appendChild( out );
		function act( fn, body ) {
			return fn( body ).then( function ( r ) {
				var e = r.data && r.data.errors && r.data.errors[ 0 ];
				msg.textContent = r.ok ? '' : ( e ? e.message : 'Something went wrong. Please try again.' );
				if ( r.data && r.data.lines ) { draw( r.data ); } else { load(); }
			} ).catch( function () { msg.textContent = 'Could not reach the shop. Please check your connection.'; } );
		}
		function load() { API.cart().then( function ( c ) { if ( current( t ) ) { draw( c ); } } ).catch( function () { if ( current( t ) ) { clear( out ); out.appendChild( retryCard( 'Could not load your cart.', load ) ); } } ); }
		function draw( c ) {
			setCount( c.count ); clear( out );
			if ( ! c.lines.length ) { out.appendChild( h( 'div', { class: 'empty' }, [ h( 'img', { src: 'assets/floral-sprig.svg', alt: '' } ), h( 'p', { text: 'Your cart is empty.' } ), h( 'a', { class: 'btn btn-primary', href: '#/shop', text: 'Start shopping' } ) ] ) ); return; }
			c.lines.forEach( function ( l ) {
				var slug = productSlug( l.url );
				var info = h( 'div', { class: 'linfo' }, [ slug ? h( 'a', { href: '#/product/' + slug, text: l.name } ) : h( 'span', { class: 'lname', text: l.name } ), lineDetails( l ) ] );
				if ( l.price_changed ) { info.appendChild( h( 'small', { class: 'note', text: 'Price updated: was ' + money( l.was_price ) + ', now ' + money( l.unit_price ) + '.' } ) ); }
				if ( ! l.ok ) { info.appendChild( h( 'small', { class: 'err', text: l.error || 'This item is unavailable.' } ) ); }
				var q = h( 'div', { class: 'qty sm' }, [ h( 'button', { type: 'button', 'aria-label': 'Fewer ' + l.name, text: '−', onclick: function () { if ( l.qty > 1 ) { act( API.cartUpdate, { line_id: l.id, qty: l.qty - 1 } ); } } } ), h( 'span', { class: 'qty-val', text: String( l.qty ) } ), h( 'button', { type: 'button', 'aria-label': 'More ' + l.name, text: '+', onclick: function () { act( API.cartUpdate, { line_id: l.id, qty: l.qty + 1 } ); } } ) ] );
				out.appendChild( h( 'div', { class: 'cline fade-up' }, [
					l.image ? h( 'img', { src: l.image, alt: '' } ) : h( 'div', { class: 'cph' } ),
					h( 'div', { class: 'lbody' }, [ info, h( 'div', { class: 'lrow' }, [ q, h( 'b', { text: l.ok ? money( l.line_total ) : '—' } ) ] ) ] ),
					h( 'button', { class: 'x', type: 'button', 'aria-label': 'Remove ' + l.name, text: '×', onclick: function () { act( API.cartRemove, { line_id: l.id } ); } } )
				] ) );
			} );
			var gap = num( c.free_delivery_gap );
			if ( gap > 0 ) {
				var pct = Math.max( 4, Math.min( 100, Math.round( num( c.subtotal ) / ( num( c.subtotal ) + gap ) * 100 ) ) ), bar = h( 'i' ); bar.style.width = pct + '%';
				out.appendChild( h( 'div', { class: 'freebar' }, [ h( 'p', { text: 'Add ' + money( gap ) + ' more for free delivery' } ), h( 'span', {}, [ bar ] ) ] ) );
			}
			var code = h( 'input', { type: 'text', placeholder: 'Discount code', value: c.coupon_code || '', 'aria-label': 'Discount code', autocapitalize: 'characters' } );
			out.appendChild( h( 'div', { class: 'coupon' }, [ code, h( 'button', { class: 'btn btn-ghost', type: 'button', text: c.coupon_code ? 'Update' : 'Apply', onclick: function () { act( API.cartCoupon, { code: code.value } ); } } ) ] ) );
			out.appendChild( msg );
			/* Video approval: customer can ask for a short video of the finished order, sent on WhatsApp. */
			var vOn = !! c.video_approval, vErr = h( 'small', { class: 'err', role: 'alert' } );
			var vWa = h( 'input', { type: 'tel', id: 'va-wa', name: 'video_whatsapp', inputmode: 'tel', autocomplete: 'tel', placeholder: '0300 1234567', value: c.video_whatsapp || '', 'aria-label': 'WhatsApp number for video approval' } );
			var vBox = h( 'div', { class: 'va-wa' }, [ h( 'label', { for: 'va-wa', text: 'WhatsApp number to send the video to' } ), vWa, vErr ] ); vBox.hidden = ! vOn;
			var vSw = h( 'input', { type: 'checkbox', id: 'va-on' } ); vSw.checked = vOn;
			function saveVideo() {
				var on = vSw.checked; vBox.hidden = ! on; vErr.textContent = '';
				return API.cartVideo( { video_approval: on ? 1 : 0, video_whatsapp: vWa.value } ).then( function ( r ) {
					if ( ! r.ok && on ) { var e = r.data && r.data.errors && r.data.errors[ 0 ]; vErr.textContent = e ? e.message : 'Please check the number.'; }
					return r.ok;
				} ).catch( function () { vErr.textContent = 'Could not reach the shop. Please check your connection.'; return false; } );
			}
			vSw.addEventListener( 'change', function () { saveVideo(); if ( vSw.checked ) { vWa.focus(); } } );
			vWa.addEventListener( 'blur', function () { if ( vSw.checked && vWa.value.trim() ) { saveVideo(); } } );
			out.appendChild( h( 'div', { class: 'vapproval' }, [
				h( 'label', { class: 'switch', for: 'va-on' }, [ vSw, h( 'i' ), h( 'span', {}, [ h( 'b', { text: 'Video approval' } ), h( 'small', { text: 'We send a short video of your finished order before it goes out.' } ) ] ) ] ),
				vBox
			] ) );
			out.appendChild( totalsBox( c ) );
			var go = h( 'a', { class: 'btn btn-primary btn-block', href: c.valid ? '#/checkout' : '#/cart', text: 'Checkout' } );
			if ( c.valid ) { go.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				saveVideo().then( function ( ok ) { if ( vSw.checked && ! ok ) { vWa.focus(); if ( vWa.scrollIntoView ) { vWa.scrollIntoView( { block: 'center', behavior: 'smooth' } ); } return; } location.hash = '#/checkout'; } );
			} ); }
			if ( ! c.valid ) { go.setAttribute( 'aria-disabled', 'true' ); out.appendChild( h( 'p', { class: 'err center', text: ( c.issues && c.issues[ 0 ] ) || 'Please fix the items marked above.' } ) ); }
			out.appendChild( go );
		}
		load();
		return wrap;
	}

	/* ---------- checkout ---------- */
	function checkoutScreen( t ) {
		setTab( 'cart' );
		var wrap = h( 'div', { class: 'screen' } ), out = h( 'div' );
		wrap.appendChild( h( 'div', { class: 'page-title' }, [ h( 'a', { class: 'iconbtn dark', href: '#/cart', 'aria-label': 'Back to cart' }, [ icon( 'back' ) ] ), h( 'h1', { text: 'Checkout' } ) ] ) ); wrap.appendChild( out );

		function fld( name, label, input, hint ) { return h( 'div', { class: 'field' }, [ h( 'label', { class: 'lab', for: 'co-' + name, text: label } ), input, hint ? h( 'small', { class: 'hint', text: hint } ) : null, h( 'small', { class: 'err', 'data-error-for': name, role: 'alert' } ) ] ); }
		function inp( name, type, extra ) { return h( 'input', Object.assign( { type: type || 'text', name: name, id: 'co-' + name }, extra || {} ) ); }

		function build( c, keep ) {
			clear( out );
			if ( ! c.lines.length ) { out.appendChild( h( 'div', { class: 'empty' }, [ h( 'p', { text: 'Your cart is empty.' } ), h( 'a', { class: 'btn btn-primary', href: '#/shop', text: 'Start shopping' } ) ] ) ); return; }
			var prof = jget( 'bless_profile', {} ), vals = Object.assign( {}, prof, keep || {} );
			var form = h( 'form', { class: 'co', novalidate: true, autocomplete: 'on' } ), general = h( 'p', { class: 'err center', role: 'alert' } );
			var pickup = c.delivery_method === 'pickup';

			if ( c.pickup_enabled ) {
				var seg = h( 'div', { class: 'seg', role: 'tablist' } );
				[ [ 'delivery', 'Delivery' ], [ 'pickup', 'Pickup from shop' ] ].forEach( function ( o ) {
					seg.appendChild( h( 'button', { type: 'button', role: 'tab', 'aria-selected': String( ( o[ 0 ] === 'pickup' ) === pickup ), class: ( o[ 0 ] === 'pickup' ) === pickup ? 'on' : '', text: o[ 1 ], onclick: function () {
						if ( ( o[ 0 ] === 'pickup' ) === pickup ) { return; }
						var snap = {}; new FormData( form ).forEach( function ( v, k ) { snap[ k ] = v; } );
						API.cartDelivery( { method: o[ 0 ] } ).then( function () { return API.cart(); } ).then( function ( nc ) { if ( current( t ) ) { build( nc, snap ); } } );
					} } ) );
				} );
				form.appendChild( seg );
			}
			form.appendChild( h( 'h2', { text: 'Your details' } ) );
			form.appendChild( fld( 'customer_name', 'Full name', inp( 'customer_name', 'text', { autocomplete: 'name', value: vals.customer_name || '' } ) ) );
			form.appendChild( fld( 'customer_phone', 'Mobile number', inp( 'customer_phone', 'tel', { autocomplete: 'tel', inputmode: 'tel', placeholder: '0300 1234567', value: vals.customer_phone || '' } ) ) );
			form.appendChild( fld( 'customer_email', 'Email (optional)', inp( 'customer_email', 'email', { autocomplete: 'email', value: vals.customer_email || '' } ), 'We email order updates if you add one.' ) );

			form.appendChild( h( 'h2', { text: pickup ? 'Pickup' : 'Delivery' } ) );
			if ( ! pickup ) {
				var gift = h( 'input', { type: 'checkbox', id: 'co-isgift' } ), giftBox = h( 'div', { class: 'giftbox', hidden: true } );
				giftBox.appendChild( fld( 'recipient_name', 'Recipient name', inp( 'recipient_name', 'text', { value: vals.recipient_name || '' } ) ) );
				giftBox.appendChild( fld( 'recipient_phone', 'Recipient mobile (optional)', inp( 'recipient_phone', 'tel', { inputmode: 'tel', value: vals.recipient_phone || '' } ) ) );
				gift.checked = !! ( vals.recipient_name || vals.recipient_phone ); giftBox.hidden = ! gift.checked;
				gift.addEventListener( 'change', function () { giftBox.hidden = ! gift.checked; } );
				form.appendChild( h( 'label', { class: 'switch', for: 'co-isgift' }, [ gift, h( 'i' ), h( 'span', { text: 'This is a gift for someone else' } ) ] ) );
				form.appendChild( giftBox );
				form.appendChild( fld( 'delivery_address', 'Delivery address', h( 'textarea', { name: 'delivery_address', id: 'co-delivery_address', rows: '3', maxlength: '500', autocomplete: 'street-address', placeholder: 'House / flat, street, area' }, [] ) ) );
				form.querySelector( '#co-delivery_address' ).value = vals.delivery_address || '';
				var city;
				if ( cfg.cities && cfg.cities.length ) { city = h( 'select', { name: 'delivery_city', id: 'co-delivery_city' }, [ h( 'option', { value: '', text: 'Choose city' } ) ].concat( cfg.cities.map( function ( x ) { return h( 'option', { value: x, text: x } ); } ) ) ); city.value = cfg.cities.indexOf( vals.delivery_city ) > -1 ? vals.delivery_city : ''; }
				else { city = inp( 'delivery_city', 'text', { value: vals.delivery_city || '' } ); }
				form.appendChild( fld( 'delivery_city', 'City', city ) );
			}
			var date = inp( 'delivery_date', 'date', { min: cfg.min || '', max: cfg.max || '' } ); date.value = vals.delivery_date || '';
			form.appendChild( fld( 'delivery_date', pickup ? 'Pickup date' : 'Delivery date', date, cfg.min ? 'Earliest: ' + niceDate( cfg.min ) : '' ) );
			if ( cfg.slots && cfg.slots.length ) {
				var slot = h( 'select', { name: 'delivery_time', id: 'co-delivery_time' }, [ h( 'option', { value: '', text: 'Choose a time slot' } ) ].concat( cfg.slots.map( function ( x ) { return h( 'option', { value: x, text: x } ); } ) ) ); slot.value = cfg.slots.indexOf( vals.delivery_time ) > -1 ? vals.delivery_time : '';
				form.appendChild( fld( 'delivery_time', 'Time slot', slot ) );
			}
			var gm = h( 'textarea', { name: 'gift_message', id: 'co-gift_message', rows: '2', maxlength: '300', placeholder: 'Printed on the card' } ); gm.value = vals.gift_message || '';
			form.appendChild( fld( 'gift_message', 'Gift message (optional)', gm ) );
			var nt = h( 'textarea', { name: 'order_notes', id: 'co-order_notes', rows: '2', maxlength: '500', placeholder: 'Anything the shop or rider should know' } ); nt.value = vals.order_notes || '';
			form.appendChild( fld( 'order_notes', 'Notes (optional)', nt ) );

			form.appendChild( h( 'h2', { text: 'Payment' } ) );
			var refWrap = h( 'div' ), gws = cfg.gateways || [];
			function showRef() { clear( refWrap ); var sel = form.querySelector( 'input[name="payment_method"]:checked' ); var g = gws.filter( function ( x ) { return sel && x.id === sel.value; } )[ 0 ]; if ( g && g.reference ) { refWrap.appendChild( fld( 'payment_reference', 'Transaction reference (optional)', inp( 'payment_reference', 'text', { value: vals.payment_reference || '' } ), 'Add it now or send it by WhatsApp after you pay.' ) ); } }
			gws.forEach( function ( g, i ) {
				var r = h( 'input', { type: 'radio', name: 'payment_method', value: g.id, id: 'co-pay-' + g.id, checked: ( vals.payment_method ? vals.payment_method === g.id : i === 0 ) ? true : null } );
				r.addEventListener( 'change', showRef );
				form.appendChild( h( 'label', { class: 'pay', for: 'co-pay-' + g.id }, [ r, h( 'span', {}, [ h( 'b', { text: g.title } ), h( 'small', { text: g.description } ) ] ) ] ) );
			} );
			form.appendChild( h( 'small', { class: 'err', 'data-error-for': 'payment_method', role: 'alert' } ) ); form.appendChild( refWrap ); showRef();
			form.appendChild( h( 'input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'hp' } ) );

			form.appendChild( h( 'h2', { text: 'Order summary' } ) );
			c.lines.forEach( function ( l ) { form.appendChild( h( 'div', { class: 'sumline' }, [ h( 'span', {}, [ l.name + ' × ' + l.qty, lineDetails( l ) ] ), h( 'b', { text: money( l.line_total ) } ) ] ) ); } );
			if ( c.video_approval ) { form.appendChild( h( 'div', { class: 'sumline' }, [ h( 'span', {}, [ 'Video approval', h( 'div', { class: 'ldetails' }, [ h( 'small', { text: 'WhatsApp: ' + ( c.video_whatsapp || '—' ) } ) ] ) ] ), h( 'b', { text: 'Included' } ) ] ) ); }
			form.appendChild( totalsBox( c ) ); form.appendChild( h( 'small', { class: 'err', 'data-error-for': 'cart', role: 'alert' } ) ); form.appendChild( general );
			var btn = h( 'button', { type: 'submit', class: 'btn btn-primary btn-block', text: 'Place order · ' + money( c.total ) } );
			form.appendChild( btn );

			function clearErr( e ) { var n = e.target && e.target.name, s = n && form.querySelector( '[data-error-for="' + n + '"]' ); if ( s ) { s.textContent = ''; } }
			form.addEventListener( 'input', clearErr ); form.addEventListener( 'change', clearErr );
			form.addEventListener( 'submit', function ( e ) {
				e.preventDefault();
				var body = {}; new FormData( form ).forEach( function ( v, k ) { body[ k ] = typeof v === 'string' ? v.trim() : v; } );
				body.delivery_method = c.delivery_method;
				form.querySelectorAll( '[data-error-for]' ).forEach( function ( n ) { n.textContent = ''; } ); general.textContent = '';
				btn.disabled = true; btn.textContent = 'Placing your order…';
				API.checkout( body ).then( function ( res ) {
					if ( res.ok && res.data && res.data.ok ) {
						sset( 'bless_profile', JSON.stringify( { customer_name: body.customer_name, customer_phone: body.customer_phone, customer_email: body.customer_email || '', delivery_address: body.delivery_address || '', delivery_city: body.delivery_city || '' } ) );
						var key = ( String( res.data.redirect || '' ).match( /([a-f0-9]{32})/ ) || [] )[ 1 ] || '';
						var list = jget( 'bless_orders', [] ); list.unshift( { key: key, url: res.data.redirect || '', total: c.total, at: new Date().toISOString(), date: body.delivery_date, name: body.customer_name } );
						sset( 'bless_orders', JSON.stringify( list.slice( 0, 20 ) ) ); sset( 'bless_last_order', JSON.stringify( list[ 0 ] ) );
						setCount( 0 ); location.hash = '#/done'; return;
					}
					var errs = ( res.data && res.data.errors ) || { general: 'Something went wrong. Please try again.' }, firstNode = null, spill = [];
					if ( Array.isArray( errs ) ) { var o = {}; errs.forEach( function ( x ) { o[ x.field || 'general' ] = x.message; } ); errs = o; }
					Object.keys( errs ).forEach( function ( k ) {
						var s = form.querySelector( '[data-error-for="' + k + '"]' );
						if ( s ) { s.textContent = errs[ k ]; firstNode = firstNode || s; } else { spill.push( errs[ k ] ); }
					} );
					if ( spill.length ) { general.textContent = spill.join( ' ' ); firstNode = firstNode || general; }
					if ( firstNode && firstNode.scrollIntoView ) { firstNode.scrollIntoView( { block: 'center', behavior: 'smooth' } ); }
					btn.disabled = false; btn.textContent = 'Place order · ' + money( c.total );
				} ).catch( function () { general.textContent = 'Could not reach the shop. Please check your connection and try again.'; btn.disabled = false; btn.textContent = 'Place order · ' + money( c.total ); } );
			} );
			out.appendChild( form );
		}
		API.cart().then( function ( c ) { if ( current( t ) ) { setCount( c.count ); build( c ); } } ).catch( function () { if ( current( t ) ) { out.appendChild( retryCard( 'Could not load checkout.', function () { route(); } ) ); } } );
		return wrap;
	}
	function niceDate( ymd ) { var p = String( ymd ).split( '-' ); if ( p.length !== 3 ) { return ymd; } return new Date( +p[ 0 ], +p[ 1 ] - 1, +p[ 2 ] ).toLocaleDateString( 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } ); }

	function done() {
		setTab( 'cart' );
		var d = jget( 'bless_last_order', null ), kids = [ h( 'img', { class: 'sprig', src: 'assets/floral-arch.svg', alt: '' } ), h( 'div', { class: 'tick', text: '✓' } ), h( 'h1', { text: 'Thank you' } ), h( 'p', { text: 'Your order is placed. We will confirm it shortly.' } ) ];
		if ( d && d.date ) { kids.push( h( 'p', { class: 'muted', text: 'For ' + niceDate( d.date ) } ) ); }
		if ( d && d.url ) { kids.push( h( 'p', { class: 'muted', text: 'Your order page shows live progress. It is saved under Orders.' } ) ); kids.push( extLink( d.url, 'View order status', 'btn btn-gold' ) ); }
		if ( API.mode === 'demo' ) { kids.push( h( 'p', { class: 'note', text: 'Demo mode: no real order was created.' } ) ); }
		kids.push( h( 'a', { class: 'btn btn-primary', href: '#/', text: 'Back to home' } ) );
		return h( 'div', { class: 'screen done' }, kids );
	}

	function orders() {
		setTab( 'orders' );
		var wrap = h( 'div', { class: 'screen' } ), s = cfg.shop || {};
		wrap.appendChild( h( 'div', { class: 'page-title' }, [ h( 'h1', { text: 'Orders & help' } ), ornament() ] ) );
		wrap.appendChild( heading( 'Orders on this phone' ) );
		var list = jget( 'bless_orders', [] );
		if ( ! list.length ) { wrap.appendChild( h( 'p', { class: 'muted pad', text: 'Orders you place in the app will appear here.' } ) ); }
		list.forEach( function ( o ) {
			var when = new Date( o.at ).toLocaleDateString( 'en-GB', { day: 'numeric', month: 'short' } );
			var row = o.url ? h( 'a', { class: 'orow', href: o.url, onclick: function ( e ) { e.preventDefault(); openExternal( o.url ); } } ) : h( 'div', { class: 'orow' } );
			[ h( 'span', {}, [ h( 'b', { text: 'Placed ' + when } ), h( 'small', { text: o.date ? 'For ' + niceDate( o.date ) : '' } ) ] ), h( 'span', { class: 'r' }, [ h( 'b', { text: money( o.total ) } ), o.url ? h( 'small', { text: 'View status ›' } ) : null ] ) ].forEach( function ( k ) { row.appendChild( k ); } );
			wrap.appendChild( row );
		} );
		wrap.appendChild( extLink( siteUrl( 'track-order/' ), 'Track with mobile number & order number', 'btn btn-ghost btn-block' ) );
		wrap.appendChild( heading( 'Need help?' ) );
		var box = h( 'div', { class: 'helpbox' } );
		if ( s.whatsapp ) { box.appendChild( extLink( 'https://wa.me/' + String( s.whatsapp ).replace( /\D+/g, '' ), 'Chat on WhatsApp', 'btn btn-primary btn-block' ) ); }
		if ( s.phone ) { box.appendChild( h( 'a', { class: 'btn btn-ghost btn-block', href: 'tel:' + String( s.phone ).replace( /[^\d+]/g, '' ), text: 'Call ' + s.phone } ) ); }
		if ( s.email ) { box.appendChild( h( 'a', { class: 'btn btn-ghost btn-block', href: 'mailto:' + s.email, text: s.email } ) ); }
		if ( s.address ) { box.appendChild( h( 'p', { class: 'muted center', text: s.address } ) ); }
		wrap.appendChild( box );
		wrap.appendChild( h( 'p', { class: 'muted center small', text: 'BLESS app · ' + ( API.mode === 'demo' ? 'demo mode' : 'connected to the shop' ) } ) );
		return wrap;
	}


	/* ============================ sidebar ============================ */
	var drawer = null;
	function closeDrawer() { if ( drawer ) { drawer.classList.remove( 'open' ); document.body.classList.remove( 'noscroll' ); } }
	function openDrawer() { buildDrawer(); void drawer.offsetWidth; drawer.classList.add( 'open' ); document.body.classList.add( 'noscroll' ); }
	function buildDrawer() {
		if ( drawer ) { drawer.remove(); }
		var s = cfg.shop || {}, nav = h( 'nav', { class: 'drawer-nav', 'aria-label': 'Menu' } );
		function link( href, text, cls ) { return h( 'a', { href: href, class: cls || '', text: text, onclick: closeDrawer } ); }
		nav.appendChild( link( '#/', 'Home' ) ); nav.appendChild( link( '#/shop', 'All products' ) );
		nav.appendChild( h( 'p', { class: 'drawer-h', text: 'Categories' } ) );
		tree.tops.forEach( function ( c ) {
			var kids = tree.kids[ c.slug ] || [];
			if ( ! kids.length ) { nav.appendChild( link( '#/shop?cat=' + c.slug, c.name ) ); return; }
			var body = h( 'div', { class: 'drawer-sub' }, [ link( '#/shop?cat=' + c.slug, 'All ' + c.name ) ].concat( kids.map( function ( k ) { return link( '#/shop?cat=' + k.slug, k.name ); } ) ) );
			var head = h( 'button', { type: 'button', class: 'drawer-row', 'aria-expanded': 'false' }, [ h( 'span', { text: c.name } ), h( 'i', { text: '+' } ) ] );
			head.addEventListener( 'click', function () { var o = body.classList.toggle( 'open' ); head.setAttribute( 'aria-expanded', String( o ) ); head.lastChild.textContent = o ? '–' : '+'; } );
			nav.appendChild( h( 'div', {}, [ head, body ] ) );
		} );
		if ( tree.occasions.length ) { nav.appendChild( h( 'p', { class: 'drawer-h', text: 'Occasions' } ) ); tree.occasions.forEach( function ( c ) { nav.appendChild( link( '#/shop?cat=' + c.slug, c.name ) ); } ); }
		if ( tree.collections.length ) { nav.appendChild( h( 'p', { class: 'drawer-h', text: 'Collections' } ) ); tree.collections.forEach( function ( c ) { nav.appendChild( link( '#/shop?cat=' + c.slug, c.name ) ); } ); }
		nav.appendChild( h( 'p', { class: 'drawer-h', text: 'My account' } ) ); nav.appendChild( link( '#/cart', 'Cart' ) ); nav.appendChild( link( '#/orders', 'Orders' ) );
		if ( s.whatsapp ) { nav.appendChild( extLink( 'https://wa.me/' + String( s.whatsapp ).replace( /\D+/g, '' ), 'WhatsApp us' ) ); }
		if ( s.phone ) { nav.appendChild( h( 'a', { href: 'tel:' + String( s.phone ).replace( /[^\d+]/g, '' ), text: 'Call ' + s.phone } ) ); }
		drawer = h( 'div', { class: 'drawer', id: 'drawer' }, [ h( 'div', { class: 'scrim', onclick: closeDrawer } ), h( 'aside', { class: 'panel', 'aria-label': 'Sidebar' }, [ h( 'div', { class: 'panel-top' }, [ h( 'img', { src: 'assets/bless-emblem.png', alt: 'BLESS' } ), h( 'button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close menu', onclick: closeDrawer }, [ icon( 'close' ) ] ) ] ), nav ] ) ] );
		document.getElementById( 'app' ).appendChild( drawer );
	}
	document.addEventListener( 'keydown', function ( e ) { if ( e.key === 'Escape' ) { closeDrawer(); } } );

	/* ============================ chrome ============================ */
	function icon( name ) {
		var paths = { back: 'M15 5l-7 7 7 7', share: 'M12 3v12M8 7l4-4 4 4M5 13v6h14v-6', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', menu: 'M4 7h16M4 12h16M4 17h10', close: 'M6 6l12 12M18 6L6 18' };
		var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS( ns, 'svg' ), p = document.createElementNS( ns, 'path' );
		svg.setAttribute( 'viewBox', '0 0 24 24' ); svg.setAttribute( 'width', '22' ); svg.setAttribute( 'height', '22' ); svg.setAttribute( 'fill', 'none' ); svg.setAttribute( 'stroke', 'currentColor' ); svg.setAttribute( 'stroke-width', '1.7' ); svg.setAttribute( 'stroke-linecap', 'round' ); svg.setAttribute( 'stroke-linejoin', 'round' ); svg.setAttribute( 'aria-hidden', 'true' );
		p.setAttribute( 'd', paths[ name ] ); svg.appendChild( p ); return svg;
	}
	function goBack() { if ( history.length > 1 ) { history.back(); } else { location.hash = '#/'; } }
	function setTab( name ) { document.querySelectorAll( '#tabs a' ).forEach( function ( a ) { a.classList.toggle( 'active', a.getAttribute( 'data-tab' ) === name ); } ); }
	function notice( kids ) {
		var n = document.getElementById( 'notice' ); clear( n ); n.hidden = ! kids;
		if ( kids ) { kids.forEach( function ( k ) { n.appendChild( typeof k === 'string' ? document.createTextNode( k ) : k ); } ); }
	}
	function cookieWarning() {
		if ( document.getElementById( 'notice' ).dataset.cookie ) { return; }
		document.getElementById( 'notice' ).dataset.cookie = '1';
		notice( [ 'Your browser is not keeping the cart between requests (third-party cookies are blocked). Open this page in normal (not private) Chrome, or use the installed app.' ] );
	}

	function parse() {
		var raw = ( location.hash || '#/' ).slice( 1 ), parts = raw.split( '?' ), seg = parts[ 0 ].split( '/' ).filter( Boolean ), q = {};
		( parts[ 1 ] || '' ).split( '&' ).forEach( function ( kv ) { if ( kv ) { var p = kv.split( '=' ); try { q[ decodeURIComponent( p[ 0 ] ) ] = decodeURIComponent( ( p[ 1 ] || '' ).replace( /\+/g, ' ' ) ); } catch ( e ) { /* ignore bad escapes */ } } } );
		return { seg: seg, q: q };
	}
	function route() {
		var r = parse(), s = r.seg, t = ++token, node, root = ! s.length || [ 'browse', 'orders' ].indexOf( s[ 0 ] ) > -1;
		if ( ! s.length ) { node = home( t ); } else if ( s[ 0 ] === 'browse' ) { node = browse( t ); } else if ( s[ 0 ] === 'shop' ) { node = shop( t, r.q ); } else if ( s[ 0 ] === 'product' && s[ 1 ] ) { node = product( t, decodeURIComponent( s[ 1 ] ) ); }
		else if ( s[ 0 ] === 'cart' ) { node = cartScreen( t ); } else if ( s[ 0 ] === 'checkout' ) { node = checkoutScreen( t ); } else if ( s[ 0 ] === 'done' ) { node = done(); } else if ( s[ 0 ] === 'orders' ) { node = orders(); } else { node = home( t ); }
		closeDrawer(); clear( view ); view.appendChild( node ); window.scrollTo( 0, 0 );
		document.getElementById( 'app' ).classList.toggle( 'pdp', s[ 0 ] === 'product' );
		document.getElementById( 'tb-left' ).replaceChildren( root ? h( 'button', { class: 'iconbtn', type: 'button', 'aria-label': 'Open menu', onclick: openDrawer }, [ icon( 'menu' ) ] ) : h( 'button', { class: 'iconbtn', type: 'button', 'aria-label': 'Back', onclick: goBack }, [ icon( 'back' ) ] ) );
	}

	function failScreen( e ) {
		var boot = document.getElementById( 'boot' ); clear( boot );
		var why = e && e.kind === 'http' ? 'The shop answered with error ' + e.status + '. Please try again in a moment.' : 'Could not reach the shop. Please check your internet connection.';
		[ h( 'img', { src: 'assets/bless-emblem.png', alt: '', class: 'boot-logo' } ), h( 'p', { text: why } ), h( 'button', { class: 'btn btn-gold', type: 'button', text: 'Try again', onclick: function () { location.reload(); } } ) ].forEach( function ( k ) { boot.appendChild( k ); } );
	}

	API.ready.then( function () { return API.config(); } ).then( function ( c ) {
		cfg = c; tree = buildTree( c.categories || [] );
		if ( API.mode === 'demo' ) {
			var forced = API.reason === 'demo', kids = [ forced ? 'Demo mode: sample products, no real orders. ' : 'Showing a sample shop: ' + API.reason + '. ' ];
			kids.push( h( 'button', { type: 'button', class: 'link-btn light', text: forced ? 'Use the live shop' : 'Retry', onclick: function () { var u = new URL( location.href ); u.searchParams.delete( 'mode' ); location.href = u.toString(); } } ) );
			notice( kids );
		}
		var b = document.getElementById( 'boot' ); if ( b ) { b.remove(); }
		API.cart().then( function ( cart ) { setCount( cart.count ); } ).catch( function () {} );
		window.addEventListener( 'hashchange', route ); route();
	} ).catch( failScreen );

	if ( 'serviceWorker' in navigator && location.protocol.indexOf( 'http' ) === 0 && ! ( window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ) ) {
		window.addEventListener( 'load', function () { navigator.serviceWorker.register( 'sw.js' ).catch( function () {} ); } );
	}
} )();
