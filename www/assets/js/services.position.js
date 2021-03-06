NGApp.factory('PositionsService', function ( $rootScope) {

	var service = {
		bounding: null,
		locs: [],
		storageLimit : 4
	}

	/**
	 * Method adds new location to the locs array
	 */
	service.addLocation = function (loc) {
		service.locs.push(loc);
		service.storeLocations();
		$rootScope.$broadcast( 'NewLocationAdded', true );
	}

	service.storeLocations = function(){
		// Duplicated positions should not be saved at cookie
		var keys = {};
		service.locs.reverse();
		for( x in service.locs ){
			var key = service.locs[ x ].getKey();
			if( keys[ key ] ){
				service.locs[ x ].markToRemove();
			}
			keys[ key ] = true;
		}
		service.locs.reverse();

		var locs = [];
		for( x in service.locs ){
			// Stores just the served and not repeated locations
			if( service.locs[x].storeAtCookie() ){
				locs.push( service.locs[x].toCookie() );
			}
		}

		if( locs.length > service.storageLimit ){
			locs = locs.slice( locs.length - service.storageLimit );
		}
		$.totalStorage( 'locsv3', locs );
	}

	service.hasValidLocation = function(){
		for( x in service.locs ){
			if( service.locs[ x ].storeAtCookie() ){
				return true;
			}
		}
		return false;
	}

	service.removeNotServedLocation = function(){
		if( service.locs.length > 0 ){
			// Mark to remove the last added location - it is not served
			service.locs[ service.locs.length - 1 ].markToRemove();
			service.storeLocations();
		}
	}

	/**
	 * get the most recent position
	 */
	service.pos = function () {
		return ((service.locs.length) ? service.locs[service.locs.length - 1] : new Location);
	}
	return service;

});

// LocationServiceservice
NGApp.factory('LocationService', function ($location, $rootScope, RestaurantsService, PositionsService, AccountService, CommunityAliasService) {

	var service = {
		form: {
			address: ''
		},
		range: 2,
		boundingBoxMeters : 8000,
		loaded: false,
		locationNotServed: false,
		initied: false,
		loadRestaurantsPage: true,
		initied : false
	}

	var community = CommunityAliasService;

	service.account = AccountService;
	service.position = PositionsService;
	service.restaurantsService = RestaurantsService;
	/**
	 * calculate the distance between two points
	 */
	service.distance = function (params) {
		try {
			var R = 6371; // Radius of the earth in km
			var dLat = service.toRad(params.to.lat - params.from.lat);
			var dLon = service.toRad(params.to.lon - params.from.lon);
			var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
				Math.cos(service.toRad(params.from.lat)) * Math.cos(service.toRad(params.to.lat)) *
				Math.sin(dLon / 2) * Math.sin(dLon / 2);
			var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
			var d = R * c; // Distance in km
			return d;

		} catch (e) {
			var pos = service.position.pos();
			App.track('Location Error', {
				lat: pos.lat,
				lon: pos.lon,
				address: pos.address()
			});
		}
	}

	/**
	 * get the closest
	 */
	service.getClosest = function (results, latLong) {

		var from = {
			lat: latLong.lat(),
			lon: latLong.lng()
		};

		var distances = [];
		var closest = -1;

		for (i = 0; i < results.length; i++) {
			var d = service.distance({
				to: {
					lat: results[i].geometry.location.lat(),
					lon: results[i].geometry.location.lng()
				},
				from: from
			});

			distances[i] = d;
			if (closest == -1 || d < distances[closest]) {
				closest = i;
			}
		}
		return results[closest];
	}


	/**
	 * get location from the browsers geolocation
	 */
	service.getLocationByBrowser = function ( success, error, timer ) {
		var success = success || function () {};
		var error = error || function () {};

		// it is taking about 25 to 30 secs to detect the user's location at cordova
		var timer = timer || ( App.isCordova ? 30000 : 8000 );

		if ( navigator.geolocation ) {

			service.timerId = setTimeout( function () {
				error();
			}, timer );

			navigator.geolocation.getCurrentPosition(function (position) {

				clearTimeout(service.timerId);

				service.position.addLocation(new Location({
					lat: position.coords.latitude,
					lon: position.coords.longitude,
					type: 'geolocation'
				}));

				App.track('Locations Shared', {
					lat: position.coords.latitude,
					lon: position.coords.longitude
				});
				// get the city from shared location
				service.reverseGeocode( position.coords.latitude, position.coords.longitude, success, error, 'geolocation' );

			}, function( e ) {
				// error 2 = gps is off
				if( e.code == 2 ){
					App.alert( 'Where are you? Your GPS appears to be off. Turn it back on and lets do this!' );
				}
				clearTimeout(service.timerId);
				error();
			}, {
				maximumAge: 60000,
				timeout: timer,
				enableHighAccuracy: true
			} );

		} else {
			error();
		}
	}


	/**
	 * initilize location functions
	 */
	service.init = function () {

		// force refresh
		var force = false;
		if (arguments[0]) {
			force = true;
		}

		// this method could not be called twice
		if (service.initied && !force) {
			return;
		}

		// 1) set bounding to maxmind results if we have them
		if (App.config && App.config.loc && App.config.loc.lat && App.config.loc.lon) {
			service.bounding = App.config.loc;
			service.bounding.type = 'geoip';
		}

		// 2) retrieve and set location date from cookies
		var cookieLocs = $.totalStorage('locsv3');
		var cookieBounding = $.totalStorage('boundingv2');

		if (cookieLocs) {
			for (var x in cookieLocs) {
				service.position.addLocation(new Location(cookieLocs[x]._properties));
			}
		}

		if (cookieBounding) {
			service.bounding = cookieBounding;
			service.bounding.type = 'cookie';
		}

		// 3) set location info by stored user
		if (service.account && service.account.user && service.account.user.location_lat) {
			service.bounding = {
				lat: service.account.user.location_lat,
				lon: service.account.user.location_lon,
				type: 'user'
			};

			if ( !cookieLocs ) {
				service.position.addLocation(new Location({
					lat: service.account.user.location_lat,
					lon: service.account.user.location_lon,
					type: 'user'
				}));
			}
			service.loadRestaurantsPage = true;
		}

		if (service.initied) {
			return;
		}

		service.initied = true;

		if ( App.isCordova ) {
			if ( parseInt( service.position.locs.length ) > 0 ) {
				service.restaurantsService.list(
					// success - has restaurants
					function () { $rootScope.navigation.link('/food-delivery', 'instant'); },
					// no restaurant
					function () {}
				);
			}
		// 4) get a more specific bounding location result from google
		} else {
			try{
				if( google && google.load && !google.maps ){
					google.load('maps', '3', {
						callback: service.googleCallback,
						other_params: 'sensor=false'
					} );
				}
			} catch(e){}
		}
	}

	// TODO I changed this method just to make it work, it is not ready yet
	// callback for google location api
	service.googleCallback = function () {

		console.debug('PROCESSING LOCATION DATA FROM GOOGLE API');

		// if we dont have the proper location data, just populate from bounding
		var error = function () {

			if (service.bounding && service.bounding.lat && service.bounding.lon && !service.bounding.city) {

				service.reverseGeocode( service.bounding.lat, service.bounding.lon,

					// Success
					function (loc) {
						service.bounding.city = loc.city();
						service.bounding.region = '';
						service.position.addLocation(loc);
						service.restaurantsService.list(
							// Success
							function () {
								service.loadRestaurantsPage = true;
								if (App.page == 'location') {
									// #4911
									//App.go( '/food-delivery');
								}
							},
							// Error
							function () {
								$rootScope.$broadcast( 'locationError',  true );
							});
					},
					// Error
					function () {});
			}
		}

		service.loaded = true;

		if (google.loader.ClientLocation) {
			// we got a location back from google. use it
			if (google.loader.ClientLocation.latitude && google.loader.ClientLocation.longitude) {
				service.bounding = {
					lat: google.loader.ClientLocation.latitude,
					lon: google.loader.ClientLocation.longitude,
					city: google.loader.ClientLocation.address.city,
					region: google.loader.ClientLocation.address.country_code == 'US' && google.loader.ClientLocation.address.region ? google.loader.ClientLocation.address.region.toUpperCase() : google.loader.ClientLocation.address.country_code,
					type: 'googleip'
				};
			}
		}

		// 5) if there are location
		if( service.position.locs.length ){
			var loc = service.position.pos();
			service.reverseGeocode(loc.lat(), loc.lon(),
			// Success
			function (loc) {
				service.bounding = {
					lat: loc.lat(),
					lon: loc.lon(),
					city: loc.city()
				};
				service.restaurantsService.list(
					// Success
					function () {
						service.loadRestaurantsPage = true;
						if (App.page == 'location') {
							// #4911
							//App.go( '/food-delivery');
						}
					},
					// Error
					function () {
						$rootScope.$broadcast( 'locationNotServed',  true );
					});
			},
			// Error
			function () {});
		} else
		// 6) if there is no previously used locations of any kind
		if (!service.position.locs.length) {
			service.getLocationByBrowser(function ( loc ) {
						service.bounding = {
							lat: loc.lat(),
							lon: loc.lon(),
							city: loc.city(),
							type: 'geolocation'
						};
						service.position.addLocation(loc);
						service.restaurantsService.list(
							function () {
								service.loadRestaurantsPage = true;
								if (App.page == 'location') {
									// #4911
									//App.go( '/food-delivery');
								}
							},
							function () {
								$rootScope.$broadcast( 'locationNotServed',  true );
							});

			}, error);
		} else {
			error();
		}
	}


	/**
	 * geocode an address and perform callbacks
	 */
	service.geocode = function (address, success, error) {
		service.doGeocode(address, function (results) {
			if (results.alias) {
				var loc = new Location({
					address: results.alias.address(),
					entered: address,
					type: 'alias',
					lat: results.alias.lat(),
					lon: results.alias.lon(),
					city: results.alias.city(),
					prep: results.alias.prep(),
					image: results.alias.image(),
					permalink: results.alias.permalink()
				});
			} else {

				// if we have a bounding result, bind to it
				if (service.bounding) {
					var latLong = new google.maps.LatLng(service.bounding.lat, service.bounding.lon);
					var closest = service.getClosest(results, latLong);

				} else {
					var closest = results[0];
				}
				var loc = new Location({
					results: results,
					entered: address,
					type: 'user',
					lat: closest.geometry.location.lat(),
					lon: closest.geometry.location.lng()
				});
			}
			success(loc);

		}, function () {
			error();
		});
	}


	/**
	 * process the geocode result
	 */
	service.doGeocode = function (address, success, error, ignoreRoute) {
		address = $.trim(address);

		App.track('Location Entered', {
			address: address
		});

		var rsuccess = function (results) {
			success(results);
		};

		// there was no alias, do a real geocode
		var rerror = function () {
			var params = {
				address: address
			};
			// if we have a bounding result, process based on that
			if ( service.bounding && google && google.maps && google.maps.LatLng ) {

				var latLong = new google.maps.LatLng(service.bounding.lat, service.bounding.lon);

				// Create a cicle bounding box
				var circle = new google.maps.Circle({
					center: latLong,
					radius: service.boundingBoxMeters
				});
				var bounds = circle.getBounds();

				params.bounds = bounds;
			}

			// Send the request out to google
			var geocoder = new google.maps.Geocoder();
			geocoder.geocode(params, function (results, status) {
				if (status == google.maps.GeocoderStatus.OK) {
					success(results, status);
				} else {
					error(results, status);
				}
			});
		};

		community.route(address, rsuccess, rerror);
	}

	service.ordinalReplace = function( address ){
		var ordinals = { 	'first' : '1st',
											'second' : '2nd',
											'third' : '3rd',
											'fourth' : '4th',
											'fifth' : '5th',
											'sixth' : '6th',
											'seventh' : '7th',
											'eighth' : '8th',
											'ninth' : '9th',
											'tenth' : '10th',
											'eleventh' : '11th',
											'twelfth' : '12th',
											'thirteenth' : '13th',
											'fourteenth' : '14th',
											'fifteenth' : '15th',
											'sixteenth' : '16th',
											'seventeenth' : '17th',
											'eighteenth' : '18th',
											'nineteenth' : '19th',
											'twentieth' : '20th'
										};
			for( ordinal in ordinals ){
				var regex = new RegExp( '(' + ordinal + ')', 'gi' );
				address = address.replace( regex, ordinals[ordinal] );
			}
		return address;
	}

	service.doGeocodeWithBound = function(address, latLong, success, error) {
		// Create a cicle bounding box
		var circle = new google.maps.Circle( { center: latLong, radius: service.boundingBoxMeters } );
		var bounds = circle.getBounds();

		// Send the request out to google
		var geocoder = new google.maps.Geocoder();
		geocoder.geocode({address: address, bounds : bounds }, function(results, status) {
			if (status == google.maps.GeocoderStatus.OK) {
				success(results, status);
			} else {
				error(results, status);
			}
		});
	}

	/**
	 * perform a reverse geocode from lat/lon
	 */
	service.reverseGeocode = function (lat, lon, success, error, type) {

		var type = type || null;

		App.track('Location Reverse Geocode', {
			lat: lat,
			lon: lon
		});

		var geocoder = new google.maps.Geocoder();
		var latlng = new google.maps.LatLng(lat, lon);

		geocoder.geocode({
			'latLng': latlng
		}, function (results, status) {
			if (status == google.maps.GeocoderStatus.OK) {
				if (results[1]) {
					success(new Location({
						results: results,
						lat: lat,
						lon: lon,
						type : type
					}));
				} else {
					error();
				}
			} else {
				error();
			}
		});
	}

	service.theClosestAddress = function (results, latLong) {
		var lat = latLong.lat();
		var lng = latLong.lng();
		var R = 6371;
		var distances = [];
		var closest = -1;
		for (i = 0; i < results.length; i++) {
			var alat = results[i].geometry.location.lat();
			var alng = results[i].geometry.location.lng();
			var dLat = service.toRad(alat - lat);
			var dLong = service.toRad(alng - lng);
			var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
				Math.cos(service.toRad(lat)) * Math.cos(service.toRad(lat)) * Math.sin(dLong / 2) * Math.sin(dLong / 2);
			var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
			var d = R * c;
			distances[i] = d;
			if (closest == -1 || d < distances[closest]) {
				closest = i;
			}
		}

		address = results[closest];
		var loc = new Location({
			type: 'closest',
			lat: address.geometry.location.lat(),
			lon: address.geometry.location.lng()
		});
		loc.setAddressFromResult( address );
		loc.setCityFromResult( address );
		loc.setZipFromResult( address );
		return { result: address, location : loc } ;
	}


	// This method validate the acceptables types of address/location
	service.validateAddressType = function (addressLocation) {

		// Check if the address is rooftop or range_interpolated
		if (addressLocation && addressLocation.geometry && addressLocation.geometry.location_type &&
			(addressLocation.geometry.location_type == google.maps.GeocoderLocationType.ROOFTOP ||
				addressLocation.geometry.location_type == google.maps.GeocoderLocationType.RANGE_INTERPOLATED)) {
			return true;
		}

		// If the address is not rooftop neither range_interpolated it could be approximate
		if (addressLocation && addressLocation.geometry && addressLocation.geometry.location_type &&
			(addressLocation.geometry.location_type == google.maps.GeocoderLocationType.APPROXIMATE)) {
			// The address type could be premise, subpremise, intersection or establishment
			for (var x in addressLocation.types) {
				var addressType = addressLocation.types[x];
				if (addressType == 'premise' || addressType == 'subpremise' || addressType == 'intersection' || addressType == 'establishment') {
					return true;
				}
			}
		}
		// It is not valid
		return false;
	}


	/**
	 * convert killometers to miles
	 */
	service.km2Miles = function (km) {
		return km * 0.621371;
	}


	/**
	 * convert miles to killometers
	 */
	service.Miles2Km = function (miles) {
		return miles * 1.60934;
	}

	service.toRad = function( number ){
		return number * Math.PI / 180;
	}


	/**
	 * verify a location, and add to the location stack if nessicary
	 */
	service.addVerify = function () {
		if (arguments[0] && typeof arguments[1] != 'function') {
			// its lat/lon
			var success = arguments[2];
			var error = arguments[3];
		} else {
			// its text based
			var address = arguments[0];
			var success = arguments[1];
			var error = arguments[2];

			for (var x in service.locs) {
				if (service.locs[x].entered == address && service.locs[x].verified) {
					success(service.locs[x]);
					return;
				}
			}
			service.geocode(address, function (loc) {
				service.position.addLocation(loc);
				success();
				$.totalStorage.setItem('boundingv2', service.bounding);
			}, error);
		}
	}

	return service;
});
