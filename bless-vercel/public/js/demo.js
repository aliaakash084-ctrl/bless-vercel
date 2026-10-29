/* Demo backend: the same contract as the live API, answered from a snapshot (demo-data.js) of the real endpoints.
   Prices, option rules and error messages mirror bless-core's Pricing / Cart / Checkout so the screens behave the same. */
( function ( root ) {
	'use strict';
	var D = root.BLESS_DEMO_DATA || { config: {}, items: [], details: {} };
	var CFG = D.config;
	var MAX_QTY = 20, MAX_TEXT = 120, MAX_TEXTAREA = 500;

	var store = ( function () {
		try { var k = '__bless_t'; root.localStorage.setItem( k, k ); root.localStorage.removeItem( k ); return root.localStorage; } catch ( e ) {
			var m = {}; return { getItem: function ( k ) { return m[ k ] || null; }, setItem: function ( k, v ) { m[ k ] = String( v ); }, removeItem: function ( k ) { delete m[ k ]; } };
		}
	} )();

	function m2( n ) { return ( Math.round( n * 100 ) / 100 ).toFixed( 2 ); }
	function lc( s ) { return String( s == null ? '' : s ).toLowerCase(); }
	function wait( v ) { return new Promise( function ( r ) { setTimeout( function () { r( v ); }, 90 ); } ); }
	function clone( o ) { return JSON.parse( JSON.stringify( o ) ); }
	function strip( it ) { var c = clone( it ); delete c._cats; delete c._featured; return c; }

	/* ---------- catalogue ---------- */
	function products( p ) {
		p = p || {};
		var list = D.items.filter( function ( it ) {
			if ( p.cat && it._cats.indexOf( p.cat ) < 0 ) { return false; }
			if ( p.featured && ! it._featured ) { return false; }
			if ( p.q && ( lc( it.name ) + ' ' + lc( it.short ) ).indexOf( lc( p.q ) ) < 0 ) { return false; }
			return true;
		} );
		var price = function ( it ) { return parseFloat( it.price_from ); };
		var sorts = {
			newest: function ( a, b ) { return b.id - a.id; }, price_asc: function ( a, b ) { return price( a ) - price( b ); },
			price_desc: function ( a, b ) { return price( b ) - price( a ); }, name: function ( a, b ) { return a.name.localeCompare( b.name ); }
		};
		if ( sorts[ p.orderby ] ) { list = list.slice().sort( sorts[ p.orderby ] ); }
		var per = Math.max( 1, Math.min( 48, parseInt( p.per_page, 10 ) || 20 ) ), page = Math.max( 1, parseInt( p.page, 10 ) || 1 );
		return wait( { items: list.slice( ( page - 1 ) * per, page * per ).map( strip ), total: list.length, pages: Math.ceil( list.length / per ), page: page } );
	}

	/* ---------- pricing (mirrors Pricing::compute) ---------- */
	function quoteSync( b ) {
		var d = findById( b.product_id );
		var errors = [];
		function fail( f, msg ) { errors.push( { field: f, message: msg } ); }
		if ( ! d ) { return { ok: false, errors: [ { field: 'product', message: 'This product is not available.' } ], product_id: 0 }; }
		if ( d.availability === 'out_of_stock' ) { fail( 'product', 'This product is currently out of stock.' ); }
		var qty = parseInt( b.qty, 10 ) || 1;
		if ( qty < 1 ) { qty = 1; }
		if ( qty > MAX_QTY ) { fail( 'qty', 'You can order up to ' + MAX_QTY + ' of this item at a time.' ); qty = MAX_QTY; }

		var base = parseFloat( d.base_price ), variation = null, attrs = b.attributes || {};
		if ( d.variations.length ) {
			var names = Object.keys( d.attributes ), missing = names.filter( function ( n ) { return ! attrs[ n ] || ! String( attrs[ n ] ).trim(); } );
			if ( missing.length ) { fail( 'variation', 'Please choose: ' + missing.join( ', ' ) + '.' ); } else {
				var hit = d.variations.filter( function ( v ) { return names.every( function ( n ) { return lc( v.attributes[ n ] ) === lc( attrs[ n ] ); } ); } )[ 0 ];
				if ( ! hit ) { fail( 'variation', 'That combination is not available.' ); } else if ( ! hit.in_stock ) { fail( 'qty', 'This choice is out of stock.' ); } else { variation = hit; base = parseFloat( hit.price ); }
			}
		}
		var given = b.options || {}, lines = [], extra = 0;
		d.options.forEach( function ( o ) {
			var raw = given[ o.key ] == null ? '' : given[ o.key ], shown = '', add = 0;
			if ( o.type === 'select' || o.type === 'radio' ) {
				var lab = String( raw ).trim();
				if ( lab ) {
					var c = o.choices.filter( function ( x ) { return lc( x.label ) === lc( lab ); } )[ 0 ];
					if ( ! c ) { fail( o.key, 'Please choose a valid ' + o.label + '.' ); } else { shown = c.label; add = parseFloat( c.extra ); }
				}
			} else if ( o.type === 'checkbox' ) {
				if ( raw && [ '0', 'false', 'no' ].indexOf( lc( raw ) ) < 0 ) { shown = 'Yes'; add = parseFloat( o.extra ); }
			} else if ( o.type === 'text' || o.type === 'textarea' ) {
				var t = String( raw ).trim(), limit = o.type === 'text' ? MAX_TEXT : MAX_TEXTAREA;
				if ( t.length > limit ) { fail( o.key, o.label + ' must be ' + limit + ' characters or fewer.' ); t = t.slice( 0, limit ); }
				if ( t ) { shown = t; add = parseFloat( o.extra ); }
			} else if ( o.type === 'color' ) {
				var hx = lc( raw ).trim();
				if ( hx ) { if ( ! /^#[0-9a-f]{6}$/.test( hx ) ) { fail( o.key, 'Please choose a valid colour for ' + o.label + '.' ); } else { shown = hx; add = parseFloat( o.extra ); } }
			} else if ( o.type === 'image_upload' ) {
				var id = parseInt( raw, 10 );
				if ( id > 0 ) { shown = String( id ); add = parseFloat( o.extra ); }
			}
			if ( ! shown && o.required && ! errors.some( function ( e ) { return e.field === o.key; } ) ) { fail( o.key, o.label + ' is required.' ); }
			if ( shown ) { extra += add; lines.push( { key: o.key, label: o.label, type: o.type, value: shown, price: m2( add ) } ); }
		} );
		var unit = base + extra;
		return { ok: ! errors.length, errors: errors, product_id: d.id, qty: qty, variation: variation ? { attributes: variation.attributes } : null, base_price: m2( base ), options_total: m2( extra ), unit_price: m2( unit ), line_total: m2( unit * qty ), lines: lines, _slug: d.slug };
	}
	function findById( id ) { var s = Object.keys( D.details ); for ( var i = 0; i < s.length; i++ ) { if ( D.details[ s[ i ] ].id === Number( id ) ) { return D.details[ s[ i ] ]; } } return null; }

	/* ---------- cart (mirrors Cart::get / totals) ---------- */
	function load() { try { return JSON.parse( store.getItem( 'bless_demo_cart' ) ) || { items: {}, coupon: '', method: 'delivery' }; } catch ( e ) { return { items: {}, coupon: '', method: 'delivery' }; } }
	function save( s ) { store.setItem( 'bless_demo_cart', JSON.stringify( s ) ); }
	function lineId( b ) { var s = JSON.stringify( [ b.product_id, b.attributes, b.options ] ), h = 0, i; for ( i = 0; i < s.length; i++ ) { h = ( h * 31 + s.charCodeAt( i ) ) | 0; } return 'l' + ( h >>> 0 ).toString( 16 ); }
	function siteUrl() { return String( CFG.site_url || 'https://blesspk.com/' ); }

	function payload( ok, errors ) {
		var s = load(), lines = [], subtotal = 0, count = 0, valid = true, issues = [];
		Object.keys( s.items ).forEach( function ( id ) {
			var l = s.items[ id ], q = quoteSync( { product_id: l.product_id, attributes: l.attributes, options: l.options, qty: l.qty } );
			var d = findById( l.product_id ), it = D.items.filter( function ( x ) { return x.id === l.product_id; } )[ 0 ];
			if ( q.ok ) { subtotal += parseFloat( q.line_total ); } else { valid = false; issues.push( q.errors[ 0 ].message ); }
			count += q.qty;
			lines.push( { id: id, name: d.name, url: siteUrl() + 'product/' + d.slug + '/', image: it ? it.image : '', qty: q.qty, ok: q.ok, error: q.ok ? '' : q.errors[ 0 ].message,
				variation: q.variation ? q.variation.attributes : {}, options: q.lines.map( function ( x ) { return { label: x.label, type: x.type, value: x.type === 'image_upload' ? 'Photo uploaded' : x.value, price: x.price }; } ),
				unit_price: q.unit_price, line_total: q.line_total, price_changed: false, was_price: q.unit_price } );
		} );
		var discount = 0, couponErr = '';
		if ( s.coupon ) { if ( lc( s.coupon ) === 'bless10' ) { discount = Math.round( subtotal * 10 ) / 100; } else { couponErr = 'That discount code is not valid.'; } }
		var net = subtotal - discount, fee = 0, gap = 0, perFee = parseFloat( CFG.delivery_fee ) || 0, free = parseFloat( CFG.free_delivery_over ) || 0;
		if ( s.method !== 'pickup' && lines.length ) { fee = ( free > 0 && net >= free ) ? 0 : perFee; if ( fee > 0 && free > 0 ) { gap = free - net; } }
		return { ok: !! ok, errors: errors || [], video_approval: s.video ? 1 : 0, video_whatsapp: s.video || '', lines: lines, count: count, valid: valid && lines.length > 0, issues: issues, subtotal: m2( subtotal ), discount: m2( discount ), delivery_fee: m2( fee ),
			total: m2( net + fee ), coupon_code: couponErr ? '' : s.coupon, coupon_error: couponErr, delivery_method: s.method, free_delivery_gap: m2( gap ), pickup_enabled: !! CFG.pickup_enabled, currency: CFG.currency };
	}
	function res( ok, status, p ) { return wait( { ok: ok, status: status, data: p } ); }

	var uploads = 900;
	var api = {
		mode: 'demo',
		config: function () { return wait( CFG ); },
		products: products,
		product: function ( slug ) { return wait( D.details[ slug ] ? clone( D.details[ slug ] ) : null ); },
		quote: function ( b ) { var q = quoteSync( b ); delete q._slug; return wait( q ); },
		cart: function () { return wait( payload( true ) ); },
		cartAdd: function ( b ) {
			var q = quoteSync( b );
			if ( ! q.ok ) { return res( false, 422, payload( false, q.errors ) ); }
			var s = load(), nb = { product_id: Number( b.product_id ), attributes: q.variation ? q.variation.attributes : {}, options: {} };
			q.lines.forEach( function ( x ) { nb.options[ x.key ] = x.value; } );
			var id = lineId( nb ), have = s.items[ id ];
			if ( have ) { have.qty = Math.min( MAX_QTY, have.qty + q.qty ); } else { nb.qty = q.qty; s.items[ id ] = nb; }
			save( s ); return res( true, 200, payload( true ) );
		},
		cartUpdate: function ( b ) { var s = load(); if ( ! s.items[ b.line_id ] ) { return res( false, 422, payload( false, [ { field: 'cart', message: 'That item is no longer in your cart.' } ] ) ); } s.items[ b.line_id ].qty = Math.max( 1, Math.min( MAX_QTY, parseInt( b.qty, 10 ) || 1 ) ); save( s ); return res( true, 200, payload( true ) ); },
		cartRemove: function ( b ) { var s = load(); delete s.items[ b.line_id ]; save( s ); return res( true, 200, payload( true ) ); },
		cartCoupon: function ( b ) {
			var s = load(), code = String( b.code || '' ).trim();
			if ( code && lc( code ) !== 'bless10' ) { return res( false, 422, payload( false, [ { field: 'coupon', message: 'That discount code is not valid.' } ] ) ); }
			s.coupon = code; save( s ); return res( true, 200, payload( true ) );
		},
		cartDelivery: function ( b ) { var s = load(); s.method = b.method === 'pickup' ? 'pickup' : 'delivery'; save( s ); return res( true, 200, payload( true ) ); },
		cartVideo: function ( b ) {
			var s = load();
			if ( ! b.video_approval ) { delete s.video; save( s ); return res( true, 200, payload( true ) ); }
			var d = String( b.video_whatsapp || '' ).replace( /\D+/g, '' );
			if ( d.length < 10 || d.length > 15 ) { s.video = ''; save( s ); return res( false, 422, payload( false, [ { field: 'video_whatsapp', message: 'Please enter a valid WhatsApp number (for example 0300 1234567).' } ] ) ); }
			s.video = String( b.video_whatsapp ).trim(); save( s ); return res( true, 200, payload( true ) );
		},
		checkout: function ( b ) {
			var c = payload( true ), e = {}, pickup = b.delivery_method === 'pickup';
			if ( ! c.lines.length ) { return res( false, 409, { ok: false, errors: { cart: 'Your cart is empty.' } } ); }
			if ( ! c.valid ) { return res( false, 409, { ok: false, errors: { cart: 'Some items in your cart need attention: ' + c.issues.join( ' ' ) } } ); }
			if ( String( b.customer_name || '' ).trim().length < 2 ) { e.customer_name = 'Please enter your name.'; }
			var digits = String( b.customer_phone || '' ).replace( /\D+/g, '' );
			if ( digits.length < 10 || digits.length > 15 ) { e.customer_phone = 'Please enter a valid phone number (for example 0300 1234567).'; }
			if ( b.customer_email && ! /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test( b.customer_email ) ) { e.customer_email = 'That email address does not look right.'; }
			if ( ! pickup ) {
				if ( String( b.delivery_address || '' ).trim().length < 8 ) { e.delivery_address = 'Please enter the full delivery address.'; }
				if ( ! String( b.delivery_city || '' ).trim() ) { e.delivery_city = 'Please enter the city.'; }
			}
			var sv = load(); if ( c.video_approval && ! sv.video ) { e.general = 'You asked for video approval but no valid WhatsApp number is saved. Please go back to the cart and enter it.'; }
			var label = pickup ? 'pickup' : 'delivery';
			if ( ! /^\d{4}-\d{2}-\d{2}$/.test( b.delivery_date || '' ) ) { e.delivery_date = 'Please choose a ' + label + ' date.'; }
			else if ( b.delivery_date < CFG.min ) { e.delivery_date = 'The earliest ' + label + ' date is ' + CFG.min + '.'; }
			else if ( b.delivery_date > CFG.max ) { e.delivery_date = 'Please choose a date within the next 60 days.'; }
			if ( CFG.slots.length && CFG.slots.indexOf( b.delivery_time ) < 0 ) { e.delivery_time = 'Please choose a time slot.'; }
			if ( ! CFG.gateways.some( function ( g ) { return g.id === b.payment_method; } ) ) { e.payment_method = 'Please choose a payment method.'; }
			if ( Object.keys( e ).length ) { return res( false, 422, { ok: false, errors: e } ); }
			save( { items: {}, coupon: '', method: 'delivery' } );
			return res( true, 201, { ok: true, redirect: '' } );
		},
		upload: function ( file ) { uploads++; return res( true, 200, { id: uploads, thumb: '' } ); }
	};
	root.BlessDemo = api;
} )( window );
