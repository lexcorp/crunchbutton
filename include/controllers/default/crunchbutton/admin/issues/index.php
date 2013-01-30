<?php


class Controller_admin_issues extends Crunchbutton_Controller_Account {
	public function init() {
		c::view()->layout('layout/admin');

		$client = new Github\Client(
			new Github\HttpClient\CachedHttpClient(array('cache_dir' => '/tmp/github-api-cache'))
		);
		
		function getWeight($item) {
			foreach ($item['labels'] as $label) {
				switch ($label['name']) {
					case 'PRIO: LO':
						return 3;
						break;
					case 'PRIO: CBB':
						return 4;
						break;
					case 'PRIO: HI':
						return 1;
						break;
					case 'PRIO: ASAP':
						return 0;
						break;
					case 'PRIO: MED':
						return 2;
						break;
				}
			}
			return 5;
		};
		
		function issueSort($a, $b) {
			return strcmp(getWeight($a), getWeight($b));
		};

		switch (c::getPagePiece(2)) {

			case 'view':
				if (!$_COOKIE['github-token']) {
					header('Location: /admin/issues');
					exit;
				}

				$res = $client->authenticate($_COOKIE['github-token'], null, Github\Client::AUTH_HTTP_TOKEN);
				$res = $client->getHttpClient()->get('repos/crunchbutton/crunchbutton/assignees');
				$users = $res->getContent();

				foreach ($users as $user) {
					$res = $client->getHttpClient()->get('repos/crunchbutton/crunchbutton/issues?state=open&assignee='.$user['login']);
					$issues[$user['login']] = $res->getContent();
					
					usort($issues[$user['login']], 'issueSort');
				}

				c::view()->users = $users;
				c::view()->issues = $issues;
				c::view()->display('admin/issues/view');

				break;
				
			case 'auth':
				$redir = 'http://'.$_SERVER['HTTP_HOST'].'admin/issues/authcallback';
				header('Location: https://github.com/login/oauth/authorize?client_id='.c::config()->github->id.'&scope=user,repo');
				exit;

				break;
				
			case 'authcallback':
				$code = $_REQUEST['code'];
				if ($code) {
					$data = ['client_id' => c::config()->github->id, 'client_secret' => c::config()->github->secret, 'code' => $code];
					$r = new Cana_Curl('https://github.com/login/oauth/access_token', $data);
					parse_str($r->output, $params);

					if (!$params['error']) {
						$token = $params['access_token'];
						setcookie('github-token', $token);
						header('Location: /admin/issues');
						exit;
					} else {
						header('Location: /admin/issues');
						exit;
					}
					exit;
				} else {
					header('Location: /admin/issues');
					exit;
				}
				break;
			case 'logout':
				setcookie('github-token','');
				header('Location: /admin/issues');
				exit;
				break;

			default:
				if (!$_COOKIE['github-token']) {
					c::view()->display('admin/issues/auth');
				} else {
					header('Location: /admin/issues/view');
					exit;
				}
				break;
		}

	}
}
