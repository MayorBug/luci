// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require dom';
'require poll';
'require pwm.fan as fan';
'require pwm.fan_format as fanFormat';
'require pwm.fan_ui as fanUi';
'require pwm.fan_components as fanComponents';
'require ui';
'require uci';
'require view';
/* global fan fanFormat fanUi fanComponents */

function rangePercent(value) {
	if (value == null)
		return 0;
	return Math.max(0, Math.min(100, (value / 1000 - 20) / 80 * 100));
}

function temperatureCard(label, value, detail, kind, iconName) {
	var available = value != null;
	var percent = rangePercent(value);

	return E('section', {
		'class': 'pwm-fan-temperature-card ' + kind
	}, [
		E('div', { 'class': 'pwm-fan-temperature-heading' }, [
			fanComponents.icon(iconName),
			E('div', {}, [
				E('div', { 'class': 'pwm-fan-temperature-label' }, [ label ]),
				detail ? E('div', {
					'class': 'pwm-fan-muted'
				}, [ detail ]) : ''
			]),
			E('strong', { 'class': 'pwm-fan-temperature-value' }, [
				fanFormat.formatTemperature(value)
			])
		]),
		E('div', {
			'class': 'pwm-fan-temperature-scale' +
				(available ? '' : ' unavailable'),
			'role': 'meter',
			'aria-label': label,
			'aria-valuemin': '20',
			'aria-valuemax': '100',
			'aria-valuenow': available ? String(value / 1000) : null
		}, [
			E('span', { 'class': 'pwm-fan-temperature-min' }, [ '20°C' ]),
			E('span', { 'class': 'pwm-fan-temperature-track' }, [
				E('span', {
					'class': 'pwm-fan-temperature-fill',
					'style': 'width: %.2f%%'.format(percent)
				}),
				E('span', {
					'class': 'pwm-fan-temperature-marker',
					'style': 'left: %.2f%%'.format(percent),
					'hidden': available ? null : ''
				})
			]),
			E('span', { 'class': 'pwm-fan-temperature-max' }, [ '100°C' ])
		])
	]);
}

function healthText(kind, health) {
	var code = health && health.code;

	if (kind === 'monitoring' && code === 'fan_stopped')
		return _('Fan stopped');
	if (kind === 'monitoring' && code === 'modem_unavailable')
		return _('Modem unavailable');
	if (kind === 'monitoring' && code === 'tach_unavailable')
		return _('Tachometer unavailable');
	if (kind === 'monitoring' && code === 'tach_read_error')
		return _('Tachometer read failed');
	if (kind === 'monitoring' && code === 'pwm_not_applied')
		return _('Fan output was not applied');
	if (kind === 'monitoring' && code === 'temperature_unavailable')
		return _('Temperature unavailable');
	if (kind === 'monitoring' && code === 'pwm_unavailable')
		return _('Fan output unavailable');
	if (kind === 'controller' && code === 'cooling_unverified')
		return _('Cooling unverified');
	if (kind === 'controller' && code === 'controller_stopped')
		return _('Controller stopped');
	if (kind === 'controller' && code === 'invalid_configuration')
		return _('Invalid configuration');
	if (kind === 'controller' && code === 'disabled')
		return _('Disabled');
	if (kind === 'controller' && code === 'kernel')
		return _('Kernel control');
	if (kind === 'history' && health && health.state === 'error')
		return _('Write error');
	if (health && health.state === 'warning')
		return _('Warning');
	if (health && health.state === 'error')
		return _('Error');
	return _('Healthy');
}

function healthItems(status) {
	var health = status.health || {};
	var modes = status.modes || {};
	var labels = {
		monitoring: _('Monitoring'),
		controller: _('Controller'),
		history: _('History')
	};

	return Object.keys(labels).map(function(kind) {
		var item = health[kind] || {
			state: kind === 'controller' && modes.configured === 'disabled'
				? 'disabled' : 'warning',
			code: 'unknown'
		};
		return {
			kind: kind,
			label: labels[kind],
			state: item.state,
			text: healthText(kind, item)
		};
	});
}

function healthStrip(status) {
	return E('section', {
		'class': 'pwm-fan-live-health',
		'aria-label': _('Live subsystem health')
	}, healthItems(status).map(function(item) {
		return E('div', {
			'class': 'pwm-fan-health-item ' + item.state,
			'data-health-kind': item.kind
		}, [
			E('span', { 'class': 'pwm-fan-health-dot', 'aria-hidden': 'true' }),
			E('span', {}, [ item.label ]),
			E('strong', {}, [ item.text ])
		]);
	}));
}

function controllerFault(status) {
	var mode = status.modes && status.modes.configured;
	var controller = status.health && status.health.controller || {};
	var monitoring = status.health && status.health.monitoring || {};
	var fanFault = status.control && status.control.fan_fault;
	if ([ 'kernel', 'auto', 'curve', 'manual' ].indexOf(mode) < 0 ||
		controller.state === 'healthy')
		return null;
	if ([ 'controller_stopped', 'controller_stale' ].indexOf(controller.code) >= 0)
		return mode + ':' + controller.code;
	if (monitoring.state === 'error' && !fanFault)
		return null;
	if (controller.state !== 'error' && !fanFault)
		return null;
	return mode + ':' + (controller.code || 'unknown');
}

function recoveryPanel(status, onRestart) {
	var fault = controllerFault(status);
	if (!fault)
		return '';

	return fanComponents.card(_('Controller recovery'), E('div', {
		'class': 'pwm-fan-recovery'
	}, [
		E('p', {}, [
			_('The controller needs attention. Direct hardware monitoring remains active.')
		]),
		E('div', { 'class': 'pwm-fan-switch-row' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'type': 'button',
				'click': function() { onRestart(true); }
			}, [ _('Restart controller') ])
		])
	]));
}

function pidSummary(status) {
	var modes = status.modes || {};
	var control = status.control || {};
	if (modes.configured == null || modes.active !== 'auto' || !control.pid)
		return '';
	if (control.pid.state === 'idle')
		return E('div', { 'class': 'pwm-fan-muted' }, [
			_('PID idle, temperature below target')
		]);
	return E('div', { 'class': 'pwm-fan-muted' }, [
		_('Target %s °C · temperature %s °C · error %s °C')
			.format(control.pid.target_c,
				control.pid.temperature_c == null ? '—'
					: control.pid.temperature_c,
				control.pid.error_c == null ? '—' : control.pid.error_c),
		E('br'),
		fanFormat.formatPidConstants(control.pid)
	]);
}

function renderDashboard(status) {
	var modes = status.modes || {};
	var hardware = status.hardware || {};
	var hwmon = hardware.hwmon || {};
	var thermal = hardware.thermal || {};
	var tach = hardware.tach || {};
	var kernel = hardware.kernel || {};
	var modem = status.modem || {};
	var control = status.control || {};
	var available = modes.configured != null;
	var setpoint = available ? fanFormat.setpoint(status) : null;
	var mode = available
		? fanFormat.modeName(modes.active, modes.curve_style)
		: _('Unavailable');
	if (available && modes.configured !== modes.active)
		mode += ' — ' + _('saved as %s').format(
			fanFormat.modeName(modes.configured, modes.curve_style));
	var speed = !available || tach.rpm == null ? _('Not available')
		: '%d RPM'.format(tach.rpm);
	var speedDetail = '';
	if (available && tach.state === 'read_error')
		speedDetail = _('Tachometer read failed');
	else if (available && tach.state === 'unavailable')
		speedDetail = _('Tachometer unavailable');
	else if (available && tach.state === 'disabled')
		speedDetail = _('Monitoring disabled');
	var output = setpoint == null ? 0 : setpoint;
	var modemDetail = available && modem.enabled
		? modem.state === 'waiting'
			? _('Waiting for first reading')
			: modem.state === 'lost'
				? _('Temporarily unavailable; using router CPU')
				: modem.source === 'qmanager_http'
					? _('QManager public HTTP')
					: _('Quectel AT port')
		: _('Optional temperature source');
	var modemLabel = available && modem.source === 'qmanager_http'
		? _('QManager modem') : _('Quectel modem');
	var floorDetail = available && control.kernel_override
		? _('%d%% requested; kernel minimum is active.').format(
			control.requested_percent)
		: _('Minimum enforced by the kernel thermal policy');

	return E('div', {}, [
		healthStrip(status),
		E('div', { 'class': 'pwm-fan-monitor-overview' }, [
		fanComponents.card(_('Current cooling'),
			E('div', { 'class': 'pwm-fan-cooling' }, [
				E('div', { 'class': 'pwm-fan-cooling-output' }, [
					E('div', {
						'class': 'pwm-fan-output-ring' +
							(setpoint == null ? ' unavailable' : ''),
						'style': '--pwm-output: %d'.format(output),
						'role': 'meter',
						'aria-label': _('Fan output'),
						'aria-valuemin': '0',
						'aria-valuemax': '100',
						'aria-valuenow': setpoint == null
							? null : String(setpoint)
					}, [
						E('strong', {}, [
							setpoint == null ? '—'
								: '%d%%'.format(setpoint)
						])
					]),
					E('div', { 'class': 'pwm-fan-cooling-details' }, [
						E('div', { 'class': 'pwm-fan-cooling-rpm' }, [ speed ]),
					E('div', {
						'class': 'pwm-fan-muted pwm-fan-raw-pwm'
					}, [ hwmon.pwm == null
							? _('Raw PWM unavailable')
							: _('Raw PWM %d').format(hwmon.pwm) ])
					]),
					E('div', {
						'class': 'pwm-fan-muted pwm-fan-speed-detail' +
							(speedDetail ? '' : ' pwm-fan-hidden')
					}, [ speedDetail ])
				]),
				E('div', { 'class': 'pwm-fan-cooling-summary' }, [
					E('div', { 'class': 'pwm-fan-cooling-mode' }, [
						fanComponents.icon('mode'),
						E('span', {}, [ mode ])
					]),
					E('div', { 'class': 'pwm-fan-pid-summary' }, [
						pidSummary(status)
					])
				])
			]), null, 'pwm-fan-cooling-card'),
		E('div', { 'class': 'pwm-fan-temperature-stack' }, [
			temperatureCard(_('Router CPU'),
				thermal.temperature_millic,
				_('Primary temperature source'), 'cpu', 'cpu'),
			temperatureCard(modemLabel,
				modem.enabled
					? modem.temperature_millic : null,
				available && !modem.enabled
					? _('Disabled') : modemDetail,
				'modem', 'modem'),
			E('section', {
				'class': 'pwm-fan-thermal-floor' +
					(control.kernel_override ? ' active' : '')
			}, [
				fanComponents.icon('thermal'),
				E('div', {}, [
					E('strong', {}, [ _('Kernel thermal floor') ]),
					E('div', {
						'class': 'pwm-fan-muted'
					}, [ floorDetail ])
				]),
				E('strong', { 'class': 'pwm-fan-floor-value' }, [
					kernel.floor_percent == null ? _('Not available')
						: _('%d%% minimum').format(kernel.floor_percent)
				])
				])
			])
		])
	]);
}

function updateTemperatureCard(card, label, value, detail) {
	var available = value != null;
	var percent = rangePercent(value);
	var scale = card.querySelector('.pwm-fan-temperature-scale');
	card.querySelector('.pwm-fan-temperature-label').textContent = label;
	card.querySelector('.pwm-fan-temperature-heading .pwm-fan-muted').textContent = detail;
	card.querySelector('.pwm-fan-temperature-value').textContent =
		fanFormat.formatTemperature(value);
	scale.classList.toggle('unavailable', !available);
	if (available)
		scale.setAttribute('aria-valuenow', String(value / 1000));
	else
		scale.removeAttribute('aria-valuenow');
	card.querySelector('.pwm-fan-temperature-fill').style.width =
		'%.2f%%'.format(percent);
	var marker = card.querySelector('.pwm-fan-temperature-marker');
	marker.style.left = '%.2f%%'.format(percent);
	marker.hidden = !available;
}

function updateDashboard(root, status) {
	var modes = status.modes || {};
	var hardware = status.hardware || {};
	var hwmon = hardware.hwmon || {};
	var thermal = hardware.thermal || {};
	var tach = hardware.tach || {};
	var kernel = hardware.kernel || {};
	var modem = status.modem || {};
	var control = status.control || {};
	var available = modes.configured != null;
	var setpoint = available ? fanFormat.setpoint(status) : null;
	var output = setpoint == null ? 0 : setpoint;
	var mode = available
		? fanFormat.modeName(modes.active, modes.curve_style)
		: _('Unavailable');
	if (available && modes.configured !== modes.active)
		mode += ' — ' + _('saved as %s').format(
			fanFormat.modeName(modes.configured, modes.curve_style));

	healthItems(status).forEach(function(item) {
		var node = root.querySelector('[data-health-kind="%s"]'.format(item.kind));
		node.className = 'pwm-fan-health-item ' + item.state;
		node.querySelector('strong').textContent = item.text;
	});

	var ring = root.querySelector('.pwm-fan-output-ring');
	ring.classList.toggle('unavailable', setpoint == null);
	ring.style.setProperty('--pwm-output', output);
	if (setpoint == null)
		ring.removeAttribute('aria-valuenow');
	else
		ring.setAttribute('aria-valuenow', String(setpoint));
	ring.querySelector('strong').textContent = setpoint == null
		? '—' : '%d%%'.format(setpoint);
	root.querySelector('.pwm-fan-cooling-rpm').textContent =
		!available || tach.rpm == null ? _('Not available')
			: '%d RPM'.format(tach.rpm);
	root.querySelector('.pwm-fan-raw-pwm').textContent = hwmon.pwm == null
		? _('Raw PWM unavailable') : _('Raw PWM %d').format(hwmon.pwm);
	var speedDetail = '';
	if (available && tach.state === 'read_error')
		speedDetail = _('Tachometer read failed');
	else if (available && tach.state === 'unavailable')
		speedDetail = _('Tachometer unavailable');
	else if (available && tach.state === 'disabled')
		speedDetail = _('Monitoring disabled');
	var speedNode = root.querySelector('.pwm-fan-speed-detail');
	speedNode.textContent = speedDetail;
	speedNode.classList.toggle('pwm-fan-hidden', !speedDetail);
	root.querySelector('.pwm-fan-cooling-mode span').textContent = mode;
	dom.content(root.querySelector('.pwm-fan-pid-summary'), pidSummary(status));

	var modemDetail = available && modem.enabled
		? modem.state === 'waiting' ? _('Waiting for first reading')
			: modem.state === 'lost' ? _('Temporarily unavailable; using router CPU')
				: modem.source === 'qmanager_http' ? _('QManager public HTTP')
					: _('Quectel AT port')
		: _('Optional temperature source');
	var modemLabel = available && modem.source === 'qmanager_http'
		? _('QManager modem') : _('Quectel modem');
	updateTemperatureCard(root.querySelector('.pwm-fan-temperature-card.cpu'),
		_('Router CPU'), thermal.temperature_millic,
		_('Primary temperature source'));
	updateTemperatureCard(root.querySelector('.pwm-fan-temperature-card.modem'),
		modemLabel, modem.enabled ? modem.temperature_millic : null,
		available && !modem.enabled ? _('Disabled') : modemDetail);

	var floor = root.querySelector('.pwm-fan-thermal-floor');
	floor.classList.toggle('active', !!control.kernel_override);
	floor.querySelector('.pwm-fan-muted').textContent =
		available && control.kernel_override
			? _('%d%% requested; kernel minimum is active.').format(
				control.requested_percent)
			: _('Minimum enforced by the kernel thermal policy');
	floor.querySelector('.pwm-fan-floor-value').textContent =
		kernel.floor_percent == null ? _('Not available')
			: _('%d%% minimum').format(kernel.floor_percent);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return null;
	},

	render: function() {
		var systemPromise = L.resolveDefault(uci.load('system'), null);
		var pageBody = E('div', {}, [
			fanComponents.card(_('PWM fan control'), E('div', {
				'class': 'pwm-fan-muted'
			}, [ _('Loading current status…') ]))
		]);

		function dormantCard() {
			return fanComponents.card(_('PWM fan control is disabled'), E('p', {}, [
				_('The userspace controller is not running. Cooling remains under kernel control.')
			]));
		}

		function activeDashboard(initialStatus) {
			var status = initialStatus;
			var dormant = false;
			var fanHistory;
			var historyGraph;
			var nextStatusPoll = Date.now() + 2000;
			var historyHost = E('div', { 'class': 'pwm-fan-muted' }, [
				_('Loading fan history…')
			]);
			var statusBody = E('div');
			var recoveryHost = E('div', { 'class': 'pwm-fan-recovery-host' });
			var dashboardNode;
			var recoveryFault;
			var compatibilityActive = false;
			var historyHours = 24;
			var historyLabel = fanUi.help(_('History information'),
				[ _('Fan history') ]);

			function restartController(confirmRestart) {
				var run = function() {
					return fan.serviceAction('restart').then(function(result) {
						if (!result.success)
							ui.addNotification(null, E('p', {}, [
								_('The controller could not be restarted.')
							]), 'danger');
					});
				};
				if (!confirmRestart)
					return run();
				var message = status.control && status.control.fan_fault
					? _('Restarting software cannot repair fan power, wiring, or tachometer hardware.')
					: _('Restart the controller service now?');
				ui.showModal(_('Restart controller?'), [
					E('p', {}, [ message ]),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]), ' ',
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							ui.hideModal(); return run();
						} }, [ _('Restart') ])
					])
				]);
			}

			function renderLive() {
				var compatibility = fanComponents.compatibilityPanel(status);
				if (compatibility) {
					if (!compatibilityActive)
						dom.content(statusBody, compatibility);
					compatibilityActive = true;
					dashboardNode = null;
					dom.content(recoveryHost, '');
					return;
				}
				if (!dashboardNode || compatibilityActive) {
					dashboardNode = renderDashboard(status);
					dom.content(statusBody, dashboardNode);
					compatibilityActive = false;
				}
				else {
					updateDashboard(dashboardNode, status);
				}
				var fault = controllerFault(status);
				if (fault !== recoveryFault) {
					dom.content(recoveryHost,
						fault ? recoveryPanel(status, restartController) : '');
					recoveryFault = fault;
				}
			}

			function updateHistoryDescription(hours, enabled) {
				historyHours = hours || historyHours;
				var description = enabled
					? _('One sample per minute is retained on the router for %d hours while the controller runs.')
						.format(historyHours)
					: _('Fan history is not available.');
				historyLabel.setAttribute('title',
					fanUi.formatTooltip(description));
				historyLabel.setAttribute('aria-label', description);
			}

			function updateGraphCurrent() {
				if (!fanHistory || !historyGraph)
					return;
				fanHistory.setTachEnabled(historyGraph,
					!!(status.hardware && status.hardware.tach &&
						status.hardware.tach.enabled));
				fanHistory.setModemEnabled(historyGraph,
					!!(status.modem && status.modem.enabled));
				fanHistory.updateCurrent(historyGraph, status,
					fanFormat.setpoint(status));
			}

			renderLive();
			updateHistoryDescription(historyHours, true);
			requestAnimationFrame(function() {
				Promise.all([
					systemPromise,
					L.require('pwm.fan_history')
				]).then(function(data) {
					fanHistory = data[1];
					historyGraph = fanHistory.create({
						hours: 24, enabled: true, samples: []
					});
					dom.content(historyHost, historyGraph.node);
					updateGraphCurrent();
					return fan.loadHistory();
				}).then(function(history) {
					updateHistoryDescription(history.hours, history.enabled);
					fanHistory.setHistory(historyGraph, history);
				}).catch(function() {
					dom.content(historyHost, E('div', {
						'class': 'pwm-fan-error'
					}, [ _('Fan history could not be loaded.') ]));
				});
			});

			poll.add(function() {
				if (document.hidden || dormant || Date.now() < nextStatusPoll)
					return Promise.resolve();
				nextStatusPoll = Date.now() + 2000;
				return fan.load().then(function(updated) {
					if (updated.modes && updated.modes.active === 'disabled' &&
						updated.service && updated.service.running !== true) {
						dormant = true;
						dom.content(pageBody, dormantCard());
						return;
					}
					status = updated;
					renderLive();
					updateGraphCurrent();
				});
			}, 2);
			poll.add(function() {
				if (document.hidden || dormant || !fanHistory || !historyGraph)
					return Promise.resolve();
				return fan.loadHistory().then(function(history) {
					updateHistoryDescription(history.hours, history.enabled);
					fanHistory.setHistory(historyGraph, history);
				});
			}, 60);

			var clearButton = E('button', {
				'class': 'btn cbi-button cbi-button-remove',
				'type': 'button',
				'click': function() {
					ui.showModal(_('Clear fan history?'), [
						E('p', {}, [
							_('This removes the telemetry history stored on the router.')
						]),
						E('div', { 'class': 'right' }, [
							E('button', {
								'class': 'btn',
								'click': ui.hideModal
							}, [ _('Cancel') ]), ' ',
							E('button', {
								'class': 'btn cbi-button-negative',
								'click': function() {
									return fan.clearHistory().then(function() {
										if (fanHistory && historyGraph) {
											fanHistory.setHistory(historyGraph, {
												hours: historyGraph.hours,
												samples: []
											});
										}
										ui.hideModal();
									});
								}
							}, [ _('Clear history') ])
						])
					]);
				}
			}, [ _('Clear history') ]);

			return E([], [
				statusBody,
				recoveryHost,
				fanComponents.card(historyLabel, E('div', {}, [ historyHost ]),
					clearButton, 'pwm-fan-history-card')
			]);
		}

		var statusPromise = fan.loadDashboard();
		requestAnimationFrame(function() {
			statusPromise.then(function(status) {
				if (status.modes && status.modes.active === 'disabled' &&
					status.service && status.service.running !== true)
					dom.content(pageBody, dormantCard());
				else
					dom.content(pageBody, activeDashboard(status));
			}).catch(function() {
				dom.content(pageBody, fanComponents.card(_('PWM fan control'), E('div', {
					'class': 'pwm-fan-error'
				}, [ _('Current status could not be loaded.') ])));
			});
		});

		return E([], [
			fanComponents.stylesheet(),
			E('div', {
				'class': 'pwm-fan',
				'data-page': 'monitoring'
			}, [ pageBody ])
		]);
	}
});
