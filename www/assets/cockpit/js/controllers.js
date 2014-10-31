NGApp.controller('DefaultCtrl', function ($scope, $http, $location, $routeParams, MainNavigationService, AccountService) {
	if (!AccountService.user.id_admin) {
		MainNavigationService.link('/login');
		return;
	}

	var id_order = $location.path().replace( '/', '' );
	if( !isNaN( parseInt( id_order ) ) ){
		MainNavigationService.link('/drivers/order/' + id_order);
	} else {
		if (AccountService.isRestaurant) {
			MainNavigationService.link('/restaurant/order/placement/dashboard');
		} else if (AccountService.isDriver) {
			MainNavigationService.link('/drivers/orders');
		} else {
			MainNavigationService.link('/login');
		}
	}
});

NGApp.controller('MainHeaderCtrl', function ( $scope) {} );

NGApp.controller('SideMenuCtrl', function ($scope) {
	$scope.setupPermissions = function() {}
});

NGApp.controller('InfoCtrl', function ($scope) {

});

NGApp.controller('LegalCtrl', function ($scope) {
	var join = 'moc.nottubhcnurc@nioj'.split('').reverse().join('');
	var goodbye = 'moc.nottubhcnurc@eybdoog'.split('').reverse().join('');
	$scope.join = join;
	$scope.goodbye = goodbye;
});

NGApp.controller('LoginCtrl', function($rootScope, $scope, AccountService, MainNavigationService) {

	$scope.newuser = !$.totalStorage('hasLoggedIn');
	$scope.login = function() {
		if( !$scope.username ){
			App.alert('Please enter your username', '', false, function() {
				if (!App.isPhoneGap) {
					$rootScope.focus('[name="username"]');
				}
			});
			return;
		}
		if( !$scope.password ){
			App.alert('Please enter your password', '', false, function() {
				if (!App.isPhoneGap) {
					$rootScope.focus('[name="password"]');
				}
			});
			return;
		}
		AccountService.login( $scope.username, $scope.password, function( status ) {
			if( status ){
				MainNavigationService.link( '/' );
			} else {
				$scope.error = true;
			}
		} );
	}

	// needs to be updated when the html is
	$scope.welcome = Math.floor((Math.random() * 8) + 1);
	console.debug('welcome message', $scope.welcome);
});

NGApp.controller( 'ProfileCtrl', function ( $scope, CustomerRewardService ) {
	CustomerRewardService.reward.config.value( CustomerRewardService.constants[ 'key_admin_refer_user_amt' ], function( json ){
		if( json.value ){
			$scope.ready = true;
			$scope.admin_refer_user_amt = json.value;
		}
	} );
	CustomerRewardService.reward.config.value( CustomerRewardService.constants[ 'key_customer_get_referred_amt' ], function( json ){
		if( json.value ){
			$scope.ready = true;
			$scope.customer_get_referred_amt = json.value;
		}
	} );

} );

NGApp.controller( 'NotificationAlertCtrl', function ($scope, $rootScope ) {
	$rootScope.$on('notificationAlert', function(e, title, message, fn) {
		$(':focus').blur();

		var complete = function() {
			$rootScope.closePopup();
			if (typeof fn === 'function') {
				fn();
			}
		};

		if ($scope.$$phase) {
			$scope.title = title;
			$scope.message = message;
			$scope.complete = complete;
			App.dialog.show('.notification-alert-container');

		} else {
			$rootScope.$apply(function(scope) {
				scope.title = title;
				scope.message = message;
				$scope.complete = complete;
				App.dialog.show('.notification-alert-container');
			});
		}
	});
});

NGApp.controller( 'CallText', function ($scope, $rootScope) {
	$rootScope.$on('callText', function(e, num) {
		$(':focus').blur();
		$scope.number = num;
		$scope.complete = $rootScope.closePopup;
		App.dialog.show('.notification-call-text-container');

	});
});

NGApp.filter('capitalize', function() {
	return function(input, scope) {
		if (input!=null) {
			input = input.toLowerCase();
		}
		return input.substring(0,1).toUpperCase()+input.substring(1);
	}
});