<?php

class Crunchbutton_Payment extends Cana_Table {

	const PROCESSOR_BALANCED = 'balanced';
	const PROCESSOR_STRIPE = 'stripe';

	const PAY_TYPE_PAYMENT = 'payment';

	const PAY_TYPE_REIMBURSEMENT = 'reimbursement';

	const PAYMENT_STATUS_PENDING = 'pending';
	const PAYMENT_STATUS_SUCCEEDED = 'succeeded';
	const PAYMENT_STATUS_FAILED = 'failed';
	const PAYMENT_STATUS_CANCELED = 'canceled';
	const PAYMENT_STATUS_PAID = 'paid';

	public static function credit($params = null) {

		$payment = new Payment((object)$params);
		$payment->date = date('Y-m-d H:i:s');
		$payment_type = Crunchbutton_Restaurant_Payment_Type::byRestaurant( $payment->id_restaurant );

		if( $payment->type == 'balanced' ){
			try {
					$credit = Crunchbutton_Balanced_Credit::credit( $payment_type, $payment->amount, $payment->note);
				} catch ( Exception $e ) {
						throw new Exception( $e->getMessage() );
						exit;
				}
				if( $credit && $credit->id ){
					$payment->balanced_id = $credit->id;
				}

			} elseif( $payment->type == 'stripe' ){

				// Stripe payment
				Stripe::setApiKey(c::config()->stripe->{c::getEnv()}->secret);

				try {
					if ( $payment_type->stripe_id ) {
						$credit = Stripe_Transfer::create( array(
							'amount' => $payment->amount * 100,
							'currency' => 'usd',
							'recipient' => $payment_type->stripe_id,
							'description' => $payment->note,
							'statement_descriptor' => 'Crunchbutton Orders'
						) );
						$payment->stripe_id = $credit->id;
					}

				} catch (Exception $e) {
					print_r($e);
					exit;
				}
		}
		$payment->env = c::getEnv(false);
		$payment->id_admin = c::user()->id_admin;
		$payment->save();

		if( $payment->balanced_id || $payment->stripe_id ){
			return $payment->id_payment;
		} else {
			return false;
		}
	}

	public function checkStripeStatus(){

		if( $this->amount > 0 ){
			$env = c::getEnv();

			if( $this->stripe_id && $this->env ){
				$env = ( $this->env == 'live' ) ? 'live' : 'dev';

				\Stripe\Stripe::setApiKey( c::config()->stripe->{ $env }->secret );

				$credit = \Stripe\Transfer::retrieve( $this->stripe_id );

				switch ( $credit->status ) {
					case Crunchbutton_Payment::PAYMENT_STATUS_FAILED:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_FAILED;
						$this->payment_failure_reason = $credit->failure_message;
						$this->schedule_error();
						break;
					case Crunchbutton_Payment::PAYMENT_STATUS_CANCELED:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_FAILED;
						$this->payment_failure_reason = 'Canceled';
						break;
					case Crunchbutton_Payment::PAYMENT_STATUS_PAID:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED;
						break;
					case Crunchbutton_Payment::PAYMENT_STATUS_PENDING:
					default:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_PENDING;
						break;
				}
				$this->payment_date_checked = date('Y-m-d H:i:s');
				$this->save();
			}
		} else {
			$this->payment_date_checked = date('Y-m-d H:i:s');
			$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED;
			$this->save();
		}
		return $this->payment_status;
	}

	public function checkPaymentStatus(){

		if( $this->amount > 0 ){

			if( $this->balanced_id && $this->env ){
				return $this->checkBalancedStatus();
			}

			if( $this->stripe_id && $this->env ){
				return $this->checkStripeStatus();
			}

		} else {
			$this->payment_date_checked = date('Y-m-d H:i:s');
			$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED;
			$this->save();
		}
		return false;
	}

	public function checkBalancedStatus(){

		if( $this->amount > 0 ){
			if( $this->balanced_id && $this->env ){
				$env = ( $this->env == 'live' ) ? 'live' : 'dev';
				$api_key = c::config()->balanced->{$env}->secret;
				Balanced\Settings::$api_key = $api_key;
				$url = '/credits/' . $this->balanced_id;
				$credit = Balanced\Credit::get( $url );
				switch ( $credit->status ) {
					case Crunchbutton_Payment::PAYMENT_STATUS_FAILED:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_FAILED;
						$this->payment_failure_reason = $credit->failure_reason;
						$this->schedule_error();
						break;
					case Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED;
						break;
					case Crunchbutton_Payment::PAYMENT_STATUS_PENDING;
					default:
						$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_PENDING;
						break;
				}
				$this->payment_date_checked = date('Y-m-d H:i:s');
				$this->save();
			}
		} else {
			$this->payment_date_checked = date('Y-m-d H:i:s');
			$this->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_SUCCEEDED;
			$this->save();
		}
		return $this->payment_status;
	}

	public function schedule(){
		$schedule = Cockpit_Payment_Schedule::q( 'SELECT * FROM payment_schedule WHERE id_payment = "' . $this->id_payment . '" ORDER BY id_payment_schedule DESC' );
		if( $schedule->id_payment_schedule ){
			return $schedule;
		}
		return false;
	}

	public function schedule_error(){
		$schedule = $this->schedule();
		if( $schedule ){
			$schedule->status = Cockpit_Payment_Schedule::STATUS_ERROR;
			$schedule->status_date = date('Y-m-d H:i:s');
			$schedule->log = $this->payment_failure_reason;
			$schedule->save();

			$settlement = new Settlement;
			$settlement->driverPaymentError( $schedule->id_payment_schedule );
		}
	}

	public static function credit_driver( $params = null ) {

		if( $params[ 'id_payment' ] ){
			$payment = Payment::o( $params[ 'id_payment' ] );
			// just redo payments with error
			if( !$payment->payment_status == Crunchbutton_Payment::PAYMENT_STATUS_FAILED ){
				return;
			}
			$payment->payment_status = Crunchbutton_Payment::PAYMENT_STATUS_PENDING;
			$payment->payment_date_checked = null;
			$payment->payment_failure_reason = null;
			$payment->balanced_id = null;
		} else {
			$payment = new Payment((object)$params);
		}

		$payment->date = date('Y-m-d H:i:s');
		$driver = Admin::o( $payment->id_driver );

		if( !$driver->hasPaymentInfo() ){
			return false;
		}

		$payment_type = $driver->payment_type();

		switch ( Crunchbutton_Payment::processor() ) {

			case Crunchbutton_Payment::PROCESSOR_BALANCED:
				try {
					$credit = Crunchbutton_Balanced_Credit::credit( $payment_type, $payment->amount, $payment->note );
				} catch ( Exception $e ) {
						throw new Exception( $e->getMessage() );
						exit;
				}
				if( $credit && $credit->id ){
					$payment->balanced_id = $credit->id;
				}
			break;

			case Crunchbutton_Payment::PROCESSOR_STRIPE:
				try {
					$credit = Crunchbutton_Stripe_Credit::credit( $payment_type->stripe_id, $payment->amount, $payment->note );
				} catch ( Exception $e ) {
						throw new Exception( $e->getMessage() );
						exit;
				}
				if( $credit && $credit->id ){
					$payment->stripe_id = $credit->id;
				}
			break;
		}

		$payment->env = c::getEnv(false);
		$payment->id_admin = c::user()->id_admin;
		$payment->save();

		if( $payment->balanced_id || $payment->stripe_id ){
			return $payment->id_payment;
		} else {
			return false;
		}

	}

	public function infoLink(){
		if( $this->type() == 'stripe' ){
			return '<a href="https://manage.stripe.com/transfers/' . $this->stripe_id . '">' . $this->stripe_id . '</a>';
		}
		if( $this->type() == 'balanced' ){
			return $this->balanced_id;
		}
	}

	public function restaurant() {
		return Restaurant::o($this->id_restaurant);
	}

	public function listPayments( $search = [] ){
		$query = '';
		$where = ' WHERE 1=1 ';
		$limit = ( $search[ 'limit' ] ) ? ' LIMIT ' . $search[ 'limit' ] : '';
		if( $search[ 'type' ] ){
			if( $search[ 'type' ] == 'restaurant' ){

				if( $search[ 'id_restaurant' ] ){
					$where .= ' AND p.id_restaurant = ' . $search[ 'id_restaurant' ];
				}

				$query = 'SELECT p.*, r.name AS restaurant, ps.id_payment_schedule FROM payment p
								LEFT OUTER JOIN payment_schedule ps ON ps.id_payment = p.id_payment
								INNER JOIN restaurant r ON r.id_restaurant = p.id_restaurant
								' . $where . '
								ORDER BY p.id_payment DESC ' . $limit;

			}
			if( $search[ 'type' ] == 'driver' ){

				if( $search[ 'id_driver' ] ){
					$where .= ' AND p.id_driver = ' . $search[ 'id_driver' ];
				}

				if( $search[ 'pay_type' ] ){
					$where .= ' AND p.pay_type = "' . $search[ 'pay_type' ] . '"';
				}

				if( $search[ 'payment_status' ] ){
					$where .= " AND p.payment_status = '" . $search[ 'payment_status' ] . "'";
				}

				$query = 'SELECT p.*, a.name AS driver, ps.id_payment_schedule FROM payment p
								LEFT OUTER JOIN payment_schedule ps ON ps.id_payment = p.id_payment
								INNER JOIN admin a ON a.id_admin = p.id_driver
								' . $where . '
								ORDER BY p.id_payment DESC ' . $limit;
			}
		}

		if( $query != '' ){
			return Crunchbutton_Payment::q( $query );
		}
	}

	public function date() {
		if (!isset($this->_date)) {
			$this->_date = new DateTime( $this->date, new DateTimeZone( c::config()->timezone ) );
		}
		return $this->_date;
	}

	public function payment_date_checked(){
		if (!isset($this->_payment_date_checked)) {
			if( $this->payment_date_checked ){
				$this->_payment_date_checked = new DateTime( $this->payment_date_checked, new DateTimeZone( c::config()->timezone ) );
			} else {
				return false;
			}
		}
		return $this->_payment_date_checked;
	}

	public function summary_sent_date() {
		if (!isset($this->_summary_sent_date)) {
			$this->_summary_sent_date = new DateTime( $this->summary_sent_date, new DateTimeZone( c::config()->timezone ) );
		}
		return $this->_summary_sent_date;
	}

	public function type(){
		if( $this->stripe_id ){
			return 'stripe';
		} else {
			return 'balanced';
		}
	}

	public function processor(){
		return c::config()->site->config('processor_payments')->value;
	}

	public function __construct($id = null) {
		parent::__construct();
		$this
			->table('payment')
			->idVar('id_payment')
			->load($id);
	}
}