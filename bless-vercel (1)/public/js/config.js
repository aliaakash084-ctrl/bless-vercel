/* BLESS app settings.

   SERVER_URL  the address of your BLESS server (the Node app). Only needed for the installed phone app (Android/iOS),
               because there the app files live on the phone. When the app is opened from the server itself
               (https://yourshop.com) it automatically talks to that same address.
   MODE        'live' = real shop (recommended). 'demo' = built-in sample data, nothing is saved.
               Testing helpers (address bar): ?mode=demo  ?mode=live   ?api=http://localhost:3000 (local server only) */
( function () {
	var SERVER_URL = 'https://YOUR-SHOP-DOMAIN.com';

	var native = !! ( window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() );
	var web = /^https?:$/.test( location.protocol ) && ! native;
	var origin = web ? location.origin : SERVER_URL.replace( /\/+$/, '' );
	window.BLESS_CONFIG = {
		SITE_URL: origin,
		API_BASE: origin + '/api/v1/',
		MODE: 'live'
	};
} )();
