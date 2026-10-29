/* One interface (window.BlessAPI) over two backends: the live bless/v1 REST API, or the demo engine.
   Every method resolves { ok, status, data } for writes and plain data for reads; network failures reject.

   Live routes used (all exist in bless-core 0.14.2):
     GET app/config, app/products, app/products/{slug}, session, cart
     POST quote, upload, cart/add|update|remove|coupon|delivery|video, checkout            */
( function () {
	'use strict';
	var C = window.BLESS_CONFIG, q = location.search;
	var forced = ( q.match( /[?&]mode=(demo|live|auto)\b/ ) || [] )[ 1 ];
	var MODE = forced || C.MODE || 'auto';
	var apiParam = ( q.match( /[?&]api=([^&]+)/ ) || [] )[ 1 ];
	if ( apiParam ) { // only ever to a local WordPress, so a crafted link cannot point the app at someone else's server
		var u = decodeURIComponent( apiParam ).replace( /\/+$/, '' );
		if ( /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test( u ) ) { C.API_BASE = u + '/wp-json/bless/v1/'; C.SITE_URL = u; }
	}
	var BASE = C.API_BASE;

	function netError( e ) { var err = new Error( 'network' ); err.kind = 'network'; err.cause = e; return err; }

	/* The cart belongs to a random id kept on this device and sent with every request, so it never depends on cookies. */
	var memSid = '';
	function sid() {
		var ok = /^[A-Za-z0-9_-]{16,64}$/, v = '';
		try { v = window.localStorage.getItem( 'bless_sid' ) || ''; } catch ( e ) { v = memSid; }
		if ( ! ok.test( v ) ) {
			var a = new Uint8Array( 18 ), s = '';
			( window.crypto || window.msCrypto ).getRandomValues( a );
			for ( var i = 0; i < a.length; i++ ) { s += ( a[ i ] + 256 ).toString( 16 ).slice( 1 ); }
			v = s; memSid = v;
			try { window.localStorage.setItem( 'bless_sid', v ); } catch ( e ) { /* kept in memory for this visit */ }
		}
		return v;
	}

	function request( method, path, body, form ) {
		var opt = { method: method, credentials: 'omit', cache: 'no-store', headers: { 'X-Bless-Session': sid() } };
		if ( body !== undefined && ! form ) { opt.headers[ 'Content-Type' ] = 'application/json'; opt.body = JSON.stringify( body ); }
		if ( form ) { opt.body = form; }
		return { opt: opt, path: path };
	}
	function send( r ) {
		return fetch( BASE + r.path, r.opt ).then( function ( res ) {
			return res.text().then( function ( t ) {
				var data = null; try { data = t ? JSON.parse( t ) : null; } catch ( e ) { data = null; }
				return { ok: res.ok, status: res.status, data: data };
			} );
		}, function ( e ) { throw netError( e ); } );
	}

	var nonce = null;
	function getNonce( fresh ) {
		if ( ! nonce || fresh ) {
			nonce = send( request( 'GET', 'session' ) ).then( function ( r ) {
				if ( ! r.ok || ! r.data || ! r.data.nonce ) { throw netError( new Error( 'session ' + r.status ) ); }
				return r.data.nonce;
			} ).catch( function ( e ) { nonce = null; throw e; } );
		}
		return nonce;
	}
	function post( path, body, form, retried ) {
		return getNonce( false ).then( function ( n ) {
			var r = request( 'POST', path, body, form );
			r.opt.headers[ 'X-Bless-Nonce' ] = n;
			return send( r );
		} ).then( function ( res ) {
			if ( res.status === 401 && ! retried && ! form ) { return getNonce( true ).then( function () { return post( path, body, form, true ); } ); }
			return res;
		} );
	}
	function qs( o ) {
		var a = []; Object.keys( o || {} ).forEach( function ( k ) { if ( o[ k ] !== undefined && o[ k ] !== '' && o[ k ] !== null ) { a.push( encodeURIComponent( k ) + '=' + encodeURIComponent( o[ k ] ) ); } } );
		return a.length ? '?' + a.join( '&' ) : '';
	}
	function read( path ) { return send( request( 'GET', path ) ); }
	function need( r, what ) {
		if ( r.ok && r.data ) { return r.data; }
		var e = new Error( what + ' ' + r.status ); e.kind = 'http'; e.status = r.status; throw e;
	}

	var cfgPromise = null;
	var live = {
		mode: 'live',
		config: function () {
			if ( ! cfgPromise ) { cfgPromise = read( 'app/config' ).then( function ( r ) { return need( r, 'config' ); } ).catch( function ( e ) { cfgPromise = null; throw e; } ); }
			return cfgPromise;
		},
		products: function ( p ) { return read( 'app/products' + qs( p ) ).then( function ( r ) { return need( r, 'products' ); } ); },
		product: function ( slug ) { return read( 'app/products/' + encodeURIComponent( slug ) ).then( function ( r ) { if ( r.status === 404 ) { return null; } return need( r, 'product' ); } ); },
		quote: function ( b ) { return post( 'quote', b ).then( function ( r ) { return need( r, 'quote' ); } ); },
		cart: function () { return read( 'cart' ).then( function ( r ) { return need( r, 'cart' ); } ); },
		cartAdd: function ( b ) { return post( 'cart/add', b ); },
		cartUpdate: function ( b ) { return post( 'cart/update', b ); },
		cartRemove: function ( b ) { return post( 'cart/remove', b ); },
		cartCoupon: function ( b ) { return post( 'cart/coupon', b ); },
		cartDelivery: function ( b ) { return post( 'cart/delivery', b ); },
		cartVideo: function ( b ) { return post( 'cart/video', b ); },
		checkout: function ( b ) { return post( 'checkout', b ); },
		upload: function ( file ) { var fd = new FormData(); fd.append( 'file', file ); return post( 'upload', undefined, fd ); }
	};

	function timeout( ms, p ) {
		return new Promise( function ( res, rej ) {
			var t = setTimeout( function () { rej( netError( new Error( 'timeout' ) ) ); }, ms );
			p.then( function ( v ) { clearTimeout( t ); res( v ); }, function ( e ) { clearTimeout( t ); rej( e ); } );
		} );
	}

	var api = window.BlessAPI = { mode: 'live', reason: '', base: BASE, ready: null };
	function use( impl ) { Object.keys( impl ).forEach( function ( k ) { api[ k ] = impl[ k ]; } ); }

	api.ready = ( function () {
		if ( MODE === 'demo' ) { use( window.BlessDemo ); api.reason = 'demo'; return Promise.resolve( 'demo' ); }
		use( live );
		return timeout( 30000, live.config() ).then( function () { return 'live'; } ).catch( function ( e ) {
			if ( MODE === 'auto' && window.BlessDemo ) {
				use( window.BlessDemo );
				api.reason = e.kind === 'http' ? ( 'the shop answered with error ' + e.status + ' ' ) : 'the shop could not be reached from this address (offline, or this address is not listed under BLESS > Store settings > Mobile app)';
				return 'demo';
			}
			throw e;
		} );
	} )();
} )();
