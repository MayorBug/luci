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
'require view';
/* global fan fanFormat fanUi fanComponents */

function loadDraft(config) {
	var draft = {};
	var values = config && config.values || {};
	var defaults = config && config.defaults || {};
	[
		'manual_output_percent', 'manual_timeout_min', 'control_interval_s',
		'curve_points', 'curve_hysteresis_c', 'tach_enabled',
		'modem_at_device', 'modem_http_host', 'modem_interval_s',
		'pid_target_c', 'pid_integral_limit',
		'mode', 'curve_style', 'temperature_filter', 'temperature_filter_duration_s',
		'modem_monitoring', 'modem_source', 'pid_kp', 'pid_ki', 'pid_kd',
		'hwmon_name', 'thermal_zone'
	].forEach(function(key) {
		var source = key;
		var value = values[source];
		var modemSource = values.modem_source == null
			? defaults.modem_source : values.modem_source;
		if (key === 'modem_monitoring')
			value = modemSource === 'off' ? '0' : '1';
		else if (key === 'modem_source')
			value = modemSource === 'quectel_at' ? 'at'
				: modemSource === 'qmanager_http' || modemSource === 'off'
					? 'http' : modemSource;
		else if (key === 'curve_points' && typeof value === 'string')
			value = value.split(',');
		if (value == null || value === '')
			value = defaults[source];
		if (key === 'modem_monitoring' && value == null)
			value = '0';
		if (key === 'modem_source' && value == null)
			value = 'http';
		if (key === 'curve_points')
			value = Array.isArray(value) ? value :
				value == null ? [] : [ value ];
		draft[key] = Array.isArray(value) ? value.slice() : String(value);
	});
	return draft;
}

function controllerConfig(draft) {
	return {
		config_version: '2',
		mode: draft.mode,
		control_interval_s: draft.control_interval_s,
		hwmon_name: draft.hwmon_name,
		thermal_zone: draft.thermal_zone,
		tach_enabled: draft.tach_enabled,
		temperature_filter: draft.temperature_filter,
		temperature_filter_duration_s: draft.temperature_filter_duration_s,
		modem_source: draft.modem_monitoring === '1'
			? draft.modem_source === 'at' ? 'quectel_at'
				: draft.modem_source === 'http' ? 'qmanager_http'
					: draft.modem_source
			: 'off',
		modem_http_host: draft.modem_http_host,
		modem_at_device: draft.modem_at_device,
		modem_interval_s: draft.modem_interval_s,
		pid_target_c: draft.pid_target_c,
		pid_kp: draft.pid_kp,
		pid_ki: draft.pid_ki,
		pid_kd: draft.pid_kd,
		pid_integral_limit: draft.pid_integral_limit,
		curve_style: draft.curve_style,
		curve_hysteresis_c: draft.curve_hysteresis_c,
		curve_points: draft.curve_points.join(','),
		manual_output_percent: draft.manual_output_percent,
		manual_timeout_min: draft.manual_timeout_min
	};
}

function setPageActionsDisabled(disabled) {
	document.querySelectorAll('.cbi-page-actions button').forEach(function(button) {
		button.disabled = disabled;
	});
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function(data) {
		var self = this;
		if (!data) {
			var loadingHost = E('div', {}, [
				E('div', { 'class': 'pwm-fan' }, [
					fanComponents.card(_('Settings'), E('p', { 'class': 'pwm-fan-muted' }, [
						_('Loading settings…')
					]))
				])
			]);
			this.settingsReady = false;
			requestAnimationFrame(function() {
				setPageActionsDisabled(true);
				fan.loadSettings().then(function(loaded) {
					dom.content(loadingHost, self.render(loaded));
					requestAnimationFrame(function() {
						setPageActionsDisabled(false);
					});
				}).catch(function(error) {
					dom.content(loadingHost, fanComponents.card(_('Settings unavailable'),
						E('p', { 'class': 'pwm-fan-error' }, [ error.message ])));
				});
			});
			return E([], [ fanComponents.stylesheet(), loadingHost ]);
		}
		var config = data[0];
		var status = data[1];
		var activeMode = status.modes && status.modes.active;
		var draft = loadDraft(config);
		var fields = {};
		var controls = {};
		var switchStates = {};
		var panels = {};
		var activeTab = 'general';
		var curveEditor;
		var curveEditorPromise;
		var probePromise;
		var probeResult;
		var hardwareDirty = false;
		var nextStatusPoll = 0;
		var settingsReady = false;
		var showAdvancedPid = false;
		var compatibility = fanComponents.compatibilityPanel(status);
		var readOnly = fanComponents.hasCompatibilityError(status);
		var hardwareBody = E('div', {}, [ fanFormat.renderHardware(status) ]);
		var inputsBody = E('div');
		var curveHost = E('div', {}, [
			E('div', { 'class': 'pwm-fan-muted' }, [ _('Loading fan curve…') ])
		]);

		this.draft = draft;
		this.settingsReady = true;
		this.fields = fields;
		this.controls = controls;
		this.status = status;
		this.configRevision = config.config_revision;
		this.activeHardware = {
			hwmon_name: status.hardware && status.hardware.hwmon.name || draft.hwmon_name,
			thermal_zone: status.hardware && status.hardware.thermal.zone || draft.thermal_zone
		};

		function labelNode(label, help, id) {
			var attributes = {
				'id': id
			};
			if (help) {
				attributes.title = fanUi.formatTooltip(help);
				attributes['aria-label'] = label + '. ' + help;
			}
			return E('label', attributes, [ label ]);
		}

		function associateControl(key, control, labelElement) {
			var input = control.matches &&
				control.matches('input,select,button') ? control :
				control.querySelector('input,select');

			if (input) {
				input.id = 'pwm-fan-' + key;
				input.setAttribute('aria-labelledby', labelElement.id);
				labelElement.setAttribute('for', input.id);
			}
			else {
				control.setAttribute('aria-labelledby', labelElement.id);
			}
		}

		function switchRow(key, control, unavailable) {
			var state = E('span', { 'class': 'pwm-fan-muted' });
			switchStates[key] = {
				node: state,
				unavailable: unavailable
			};
			return E('div', { 'class': 'pwm-fan-switch-row' }, [
				control,
				state
			]);
		}

		function updateSwitchStates() {
			Object.keys(switchStates).forEach(function(key) {
				var item = switchStates[key];
				var unavailable = typeof item.unavailable === 'function'
					? item.unavailable() : item.unavailable;
				item.node.textContent = unavailable ||
					(draft[key] === '1' ? _('Enabled') : _('Disabled'));
			});
		}

		function field(key, label, control, help, wide) {
			var helpText = typeof help === 'string' ? help : help && help.text;
			var helpContent = help && help.content ? help.content : helpText;
			var labelElement = labelNode(label, helpText,
				'pwm-fan-label-' + key);
			var error = E('div', { 'class': 'pwm-fan-error' });
			var node = E('div', {
				'class': 'pwm-fan-field' + (wide ? ' wide' : '')
			}, [
				labelElement,
				control,
				helpContent ? E('div', {
					'class': 'pwm-fan-field-help'
				}, [ helpContent ]) : '',
				error
			]);
			associateControl(key, control, labelElement);
			fields[key] = { node: node, error: error, tab: activeTab };
			controls[key] = control;
			return node;
		}

		function textControl(key, type) {
			var input = E('input', {
				'class': 'cbi-input-' +
					(type === 'number' ? 'text' : type || 'text'),
				'type': type || 'text',
				'value': draft[key],
				'input': function() {
					draft[key] = input.value;
					clearError(key);
					updateVisibility();
				}
			});
			return input;
		}

		function numberControl(key, minimum, maximum, suffix, step) {
			var input = textControl(key, 'number');
			input.min = minimum;
			input.max = maximum;
			input.step = step || 1;
			return suffix ? E('div', {
				'class': 'pwm-fan-switch-row'
			}, [ input, E('span', { 'class': 'pwm-fan-muted' }, [ suffix ]) ])
				: input;
		}

		function selectControl(key, choices) {
			var select = E('select', {
				'class': 'cbi-input-select',
				'change': function() {
					draft[key] = select.value;
					clearError(key);
					updateVisibility();
				}
			});
			Object.keys(choices).forEach(function(value) {
				select.appendChild(E('option', {
					'value': value
				}, [ choices[value] ]));
			});
			if (!Object.prototype.hasOwnProperty.call(choices, draft[key]))
				select.appendChild(E('option', {
					'value': draft[key]
				}, [ _('Invalid value: %s').format(draft[key]) ]));
			select.value = draft[key];
			return select;
		}

		function switchControl(key, label, disabled) {
			var checkbox = E('input', {
				'type': 'checkbox',
				'checked': draft[key] === '1' ? '' : null,
				'disabled': disabled ? '' : null,
				'aria-label': label,
				'change': function() {
					draft[key] = checkbox.checked ? '1' : '0';
					clearError(key);
					updateVisibility();
				}
			});
			var wrapper = E('label', {
				'class': 'pwm-fan-switch'
			}, [ checkbox, E('span') ]);
			wrapper.input = checkbox;
			return wrapper;
		}

		function segmentControl(key, choices) {
			var buttons = {};
			var node = E('div', { 'class': 'pwm-fan-segment' });
			Object.keys(choices).forEach(function(value) {
				var button = E('button', {
					'type': 'button',
					'class': draft[key] === value ? 'active' : '',
					'aria-pressed': draft[key] === value ? 'true' : 'false',
					'click': function() {
						draft[key] = value;
						Object.keys(buttons).forEach(function(name) {
							var selected = name === value;
							buttons[name].classList.toggle('active', selected);
							buttons[name].setAttribute('aria-pressed',
								selected ? 'true' : 'false');
						});
						clearError(key);
						if (key === 'curve_style' && curveEditor)
							curveEditor.setStyle(value);
						updateVisibility();
					}
				}, [ choices[value] ]);
				buttons[value] = button;
				node.appendChild(button);
			});
			node.buttons = buttons;
			return node;
		}

		function clearError(key) {
			if (!fields[key])
				return;
			fields[key].node.classList.remove('invalid');
			fields[key].error.classList.remove('warning');
			fields[key].error.textContent = '';
		}

		function useDraftValue(key, value) {
			if (key === 'curve_points') {
				draft[key] = String(value).split(',');
				if (curveEditor)
					curveEditor.setValue(draft[key]);
			}
			else if (key === 'modem_source') {
				draft.modem_monitoring = value === 'off' ? '0' : '1';
				draft.modem_source = value === 'quectel_at' ? 'at' : 'http';
				controls.modem_monitoring.querySelector('input').checked =
					draft.modem_monitoring === '1';
				controls.modem_source.value = draft.modem_source;
			}
			else {
				draft[key] = String(value);
				var control = controls[key];
				var input = control && (control.input ||
					(control.matches && control.matches('input,select') ? control :
						control.querySelector && control.querySelector('input,select')));
				if (input) {
					if (input.type === 'checkbox') input.checked = value === '1';
					else input.value = value;
				}
				if (control && control.buttons && control.buttons[value])
					control.buttons[value].click();
			}
			clearError(key);
			updateVisibility();
		}

		function applyDiagnostics(diagnostics) {
			(diagnostics || []).forEach(function(diagnostic) {
				var item = fields[diagnostic.key];
				if (!item)
					return;
				if (diagnostic.severity === 'warning') {
					item.error.textContent = diagnostic.message ||
						_('This setting is missing and currently uses its default.');
					item.error.classList.add('warning');
					return;
				}
				item.node.classList.add('invalid');
				dom.content(item.error, [
					E('span', {}, [
						(diagnostic.message || diagnostic.code) + ' ' +
						_('Current value: %s').format(diagnostic.value)
					]),
					' ',
					E('button', {
						'class': 'btn cbi-button',
						'type': 'button',
						'click': function() {
							useDraftValue(diagnostic.key, diagnostic.default_value);
						}
					}, [ _('Use default') ])
				]);
			});
		}
		self.applyDiagnostics = applyDiagnostics;
		self.setAppliedMode = function(mode) {
			activeMode = mode;
			updateVisibility();
		};

		function selectTab(tab) {
			if (tab === 'hardware' && draft.mode === 'disabled')
				return;
			activeTab = tab;
			[ 'general', 'mode', 'hardware' ].forEach(function(name) {
				panels[name].classList.toggle('active', name === tab);
			});
			nextStatusPoll = 0;
			if (tab === 'hardware') {
				if (hardwareDirty) {
					dom.content(hardwareBody, fanFormat.renderHardware(status));
					hardwareDirty = false;
				}
				ensureProbe().then(refreshStatus);
			}
			else if (tab === 'mode' && draft.mode === 'curve')
				ensureCurveEditor().then(refreshStatus);
		}

		function applyStatus(updated) {
			status = updated;
			activeMode = updated.modes && updated.modes.active;
			self.status = updated;
			if (activeTab === 'hardware')
				dom.content(hardwareBody, fanFormat.renderHardware(updated));
			else
				hardwareDirty = true;
			if (curveEditor && activeTab === 'mode' && draft.mode === 'curve')
				curveEditor.updateStatus(updated);
			renderInputs();
			updateSwitchStates();
		}

		function refreshStatus() {
			return fan.load(probeResult ? { probe: probeResult } : null)
				.then(applyStatus);
		}

		function ensureProbe() {
			if (!probePromise) {
				probePromise = fan.loadProbe().then(function(probe) {
					if (probe && probe.error === 'probe_unavailable')
						probePromise = null;
					probeResult = probe;
					applyStatus(fan.withProbe(status, probe));
					return probe;
				});
			}
			return probePromise;
		}

		function ensureCurveEditor() {
			if (curveEditorPromise)
				return curveEditorPromise;
			curveEditorPromise = Promise.all([
				ensureProbe(), L.require('pwm.fan_curve')
			]).then(function(data) {
				var fanCurve = data[1];
				curveEditor = fanCurve.create(draft.curve_points,
					status.hardware && status.hardware.kernel
						? status.hardware.kernel.policy : null, {
						style: draft.curve_style,
						status: status,
						onchange: function(value) {
							draft.curve_points = value.slice();
							clearError('curve_points');
						}
					});
				curveEditor.node.classList.add('pwm-fan-curve');
				dom.content(curveHost, curveEditor.node);
				if (readOnly) {
					curveEditor.node.querySelectorAll('input, select, button')
						.forEach(function(control) { control.disabled = true; });
				}
				return curveEditor;
			}).catch(function() {
				curveEditorPromise = null;
				dom.content(curveHost, E('div', { 'class': 'pwm-fan-error' }, [
					_('The fan curve could not be loaded.')
				]));
				return null;
			});
			return curveEditorPromise;
		}

		function dependency(key, visible) {
			if (fields[key])
				fields[key].node.classList.toggle('pwm-fan-hidden', !visible);
		}

		function renderInputs() {
			var thermal = status.hardware && status.hardware.thermal || {};
			var modem = status.modem || {};
			var modemText = draft.modem_monitoring !== '1'
				? _('Disabled')
				: !modem.enabled
					? _('Waiting')
					: fanFormat.formatTemperature(modem.temperature_millic);
			var modemLabel = draft.modem_source === 'http'
				? _('QManager modem') : _('Quectel modem');
			var activeMode = status.modes && status.modes.active;
			var controlling = (activeMode === 'auto' || activeMode === 'curve')
				? status.control && status.control.selected_temperature_source : null;
			dom.content(inputsBody, E('div', {
				'class': 'pwm-fan-field-grid'
			}, [
				fanComponents.metric(_('Router CPU'),
					fanFormat.formatTemperature(thermal.temperature_millic),
					controlling === 'cpu' ? _('Controlling') : _('Required'),
					'cpu', fanComponents.icon('cpu')),
				fanComponents.metric(modemLabel, modemText,
					controlling === 'modem' ? _('Controlling') : draft.modem_monitoring === '1'
						? _('Enabled') : _('Optional'),
					'modem', fanComponents.icon('modem'))
			]));
		}

		function updateVisibility() {
			var manual = draft.mode === 'manual';
			var curve = draft.mode === 'curve';
			var pid = draft.mode === 'auto';
			var disabled = draft.mode === 'disabled';
			var dormant = activeMode === 'disabled';
			var modem = draft.modem_monitoring === '1';
			dependency('manual_output_percent', manual);
			dependency('manual_timeout_min', manual);
			dependency('pid_target_c', pid);
			dependency('pid_kp', pid && showAdvancedPid);
			dependency('pid_ki', pid && showAdvancedPid);
			dependency('pid_kd', pid && showAdvancedPid);
			dependency('pid_integral_limit', pid && showAdvancedPid);
			dependency('curve_style', curve);
			dependency('curve_hysteresis_c', curve && draft.curve_style === 'step');
			dependency('modem_source', modem);
			dependency('modem_at_device', modem && draft.modem_source === 'at');
			dependency('modem_http_host', modem && draft.modem_source === 'http');
			dependency('modem_interval_s', modem);
			if (panels.curveControls)
				panels.curveControls.classList.toggle('pwm-fan-hidden',
					!curve);
			if (panels.curveEditor)
				panels.curveEditor.classList.toggle('pwm-fan-hidden',
					!curve);
			if (panels.curveGrid)
				panels.curveGrid.classList.toggle('pwm-fan-hidden', !curve);
			if (panels.pidAdvancedToggle)
				panels.pidAdvancedToggle.classList.toggle('pwm-fan-hidden', !pid);
			if (panels.kernelNotice)
				panels.kernelNotice.classList.toggle('pwm-fan-hidden',
					draft.mode !== 'kernel');
			if (panels.generalSettings)
				panels.generalSettings.classList.toggle('pwm-fan-hidden', disabled);
			if (panels.generalDormant)
				panels.generalDormant.classList.toggle('pwm-fan-hidden',
					!disabled || !dormant);
			if (panels.generalPending)
				panels.generalPending.classList.toggle('pwm-fan-hidden',
					!disabled || dormant);
			if (panels.modeDormant)
				panels.modeDormant.classList.toggle('pwm-fan-hidden',
					!disabled || !dormant);
			if (panels.modePending)
				panels.modePending.classList.toggle('pwm-fan-hidden',
					!disabled || dormant);
			if (panels.curveInputs)
				panels.curveInputs.classList.toggle('pwm-fan-hidden', disabled);
			if (self.tabButtons && self.tabButtons.hardware) {
				self.tabButtons.hardware.disabled = disabled;
				self.tabButtons.hardware.setAttribute('aria-disabled',
					disabled ? 'true' : 'false');
			}
			if (activeTab === 'mode' && curve)
				ensureCurveEditor();
			updateSwitchStates();
			renderInputs();
		}

		activeTab = 'general';
		var filter = selectControl('temperature_filter', {
			none: _('Off'),
			median: _('Moving median')
		});
		var generalFields = E('div', { 'class': 'pwm-fan-field-grid' }, [
			field('control_interval_s', _('Fan control interval'),
				numberControl('control_interval_s', 1, 60, _('seconds')),
				_('Seconds between userspace fan updates.')),
			field('temperature_filter', _('Temperature filter'), filter,
				_('Auto and Curve modes use this filter.')),
			field('temperature_filter_duration_s', _('Filter duration'),
				selectControl('temperature_filter_duration_s', {
					5: _('5 seconds'),
					10: _('10 seconds'),
					15: _('15 seconds')
				}),
				_('The moving median uses readings from this time period.'))
		]);
		panels.generalSettings = fanComponents.card(null, generalFields);
		panels.generalDormant = fanComponents.card(_('PWM fan control is dormant'),
			E('p', {}, [
				_('Select an active mode under Mode to configure the controller.')
			]));
		panels.generalPending = fanComponents.card(_('Disabled mode is not active'),
			E('p', {}, [
				_('Save & Apply to stop the controller. The active mode continues until you apply the change.')
			]));
		panels.general = E('div', {
			'class': 'pwm-fan-panel active',
			'role': 'tabpanel',
			'id': 'pwm-fan-settings-panel-general',
			'aria-labelledby': 'pwm-fan-settings-tab-general'
		}, [ panels.generalSettings, panels.generalDormant,
			panels.generalPending ]);

		activeTab = 'mode';
		var mode = segmentControl('mode', fanFormat.modeChoices());
		var advancedPidCheckbox = E('input', {
			'type': 'checkbox',
			'aria-label': _('Show advanced PID options'),
			'change': function() {
				showAdvancedPid = advancedPidCheckbox.checked;
				updateVisibility();
			}
		});
		panels.pidAdvancedToggle = E('div', {
			'class': 'pwm-fan-field wide pwm-fan-pid-advanced'
		}, [
			E('label', { 'class': 'pwm-fan-switch-row' }, [
				advancedPidCheckbox,
				E('span', {}, [ _('Show advanced PID options') ])
			])
		]);
		var modeFields = E('div', { 'class': 'pwm-fan-field-grid' }, [
			field('mode', _('Operating mode'), mode, null, true),
			field('pid_target_c', _('Target temperature'),
				numberControl('pid_target_c', 30, 100, '°C', 0.1),
				_('Auto mode regulates the hottest available temperature toward this target.')),
			panels.pidAdvancedToggle,
			field('pid_kp', _('Proportional gain (Kp)'),
				numberControl('pid_kp', 0, 0.20, null, 0.001),
				_('Output added for each degree above target, expressed as output per °C.')),
			field('pid_ki', _('Integral gain (Ki)'),
				numberControl('pid_ki', 0, 0.001667, null, 0.000001),
				_('Output accumulated for each degree-second above target. Multiply by 60 for output per °C-minute.')),
			field('pid_kd', _('Derivative gain (Kd)'),
				numberControl('pid_kd', 0, 1.20, null, 0.001),
				_('Output added according to the rate at which temperature is rising. Units are output-seconds per °C.')),
			field('pid_integral_limit', _('Integral limit'),
				numberControl('pid_integral_limit', 0, 1, null, 0.01),
				_('Maximum accumulated integral output, from zero to the full output range.')),
			field('manual_output_percent', _('Manual fan output'),
				numberControl('manual_output_percent', 0, 100, '%'),
				_('The kernel thermal floor may raise this value.')),
			field('manual_timeout_min', _('Manual timeout'),
				numberControl('manual_timeout_min', 0, 1440, _('minutes')),
				_('Use 0 to disable the automatic return to kernel control.'))
		]);
		panels.kernelNotice = fanComponents.card(_('Kernel control'),
			E('p', {}, [
				_('Linux controls the fan. The service monitors fan and temperature data.')
			]));
		panels.modeDormant = fanComponents.card(_('Userspace fan control is disabled'),
			E('p', {}, [
				_('The controller is stopped and does not access the fan or temperature sensors. Linux controls the fan. Select another mode and apply the change to resume control.')
			]));
		panels.modePending = fanComponents.card(_('Disabled mode is not active'),
			E('p', {}, [
				_('Save & Apply to stop the controller. The active mode continues until you apply the change.')
			]));
		var curveStyle = segmentControl('curve_style', {
			smooth: _('Smooth'),
			step: _('Stepped')
		});
		var curveFields = E('div', { 'class': 'pwm-fan-field-grid' }, [
			field('curve_style', _('Curve response'), curveStyle,
				_('Stepped mode holds each output; smooth mode interpolates without overshoot.'), true),
			field('curve_hysteresis_c', _('Hysteresis'),
				numberControl('curve_hysteresis_c', 0, 20, '°C', 0.1),
				_('Cooling required before a stepped setpoint decreases.'))
		]);
		panels.curveControls = fanComponents.card(null,
			curveFields);
		var curveField = field('curve_points', _('Temperature curve'),
			curveHost,
			_('The higher of router CPU and available modem temperature controls fan output.'), true);
		panels.curveEditor = E('section', {
			'class': 'pwm-fan-card pwm-fan-curve-card'
		}, [ curveField ]);
		panels.curveInputs = fanComponents.card(_('Temperature inputs'), inputsBody);
		panels.curveGrid = E('div', { 'class': 'pwm-fan-grid-2' }, [
			panels.curveControls,
			panels.curveInputs
		]);
		panels.mode = E('div', {
			'class': 'pwm-fan-panel',
			'role': 'tabpanel',
			'id': 'pwm-fan-settings-panel-mode',
			'aria-labelledby': 'pwm-fan-settings-tab-mode'
		}, [
			fanComponents.card(null, modeFields),
			panels.kernelNotice,
			panels.modeDormant,
			panels.modePending,
			panels.curveGrid,
			panels.curveEditor
		]);

		activeTab = 'hardware';
		var tachSwitch = switchControl('tach_enabled',
			_('Tachometer monitoring'), !(status.hardware &&
				status.hardware.tach && status.hardware.tach.available));
		var modemSwitch = switchControl('modem_monitoring',
			_('Modem temperature'));
		var modemSource = selectControl('modem_source', {
			http: _('QManager public HTTP (recommended)'),
			at: _('AT port')
		});
		var modemSourceHelpText = _('QManager public HTTP is the recommended source. Use QManager or QManager-RM520N for your modem. Direct AT is also available. Frequent AT polling can make the modem unstable.');
		var modemSourceHelp = {
			text: modemSourceHelpText,
			content: E('span', {}, [
				_('QManager public HTTP is the recommended source.'),
				' ',
				E('a', {
					'href': 'https://github.com/dr-dolomite/QManager',
					'target': '_blank',
					'rel': 'noopener noreferrer'
				}, [ _('Open the QManager project.') ]),
				' ',
				E('a', {
					'href': 'https://github.com/dr-dolomite/QManager-RM520N',
					'target': '_blank',
					'rel': 'noopener noreferrer'
				}, [ _('Open the QManager-RM520N project.') ]),
				' ',
				_('Direct AT is also available. Frequent AT polling can make the modem unstable.')
			])
		};
		var hardwareFields = E('div', { 'class': 'pwm-fan-field-grid' }, [
			field('tach_enabled', _('Tachometer monitoring'),
				switchRow('tach_enabled', tachSwitch, function() {
					return status.hardware && status.hardware.tach &&
						status.hardware.tach.available ? ''
						: _('Not exposed by the driver');
				}), _('Disable for a fan without a tachometer wire.')),
			field('modem_monitoring', _('Modem temperature'),
				switchRow('modem_monitoring', modemSwitch),
				_('The controller uses the higher available CPU or modem temperature.')),
			field('modem_source', _('Modem source'), modemSource,
				modemSourceHelp),
			field('modem_at_device', _('Modem AT port'),
				textControl('modem_at_device'),
				_('/dev/ttyUSB2 is normally the primary AT port.')),
			field('modem_http_host', _('QManager host'),
				textControl('modem_http_host'),
				_('IPv4 address or host name serving the public overview endpoint.')),
			field('modem_interval_s', _('Polling interval'),
				numberControl('modem_interval_s', 10, 30, _('seconds')),
				_('Polling is limited to one request every 10–30 seconds.'))
		]);
		var advancedFields = E('div', { 'class': 'pwm-fan-field-grid' }, [
			field('hwmon_name', _('Hardware monitor name'),
				textControl('hwmon_name'),
				_('Advanced device matching; normally pwmfan.')),
			field('thermal_zone', _('Thermal zone name'),
				textControl('thermal_zone'),
				_('Supplies automatic control and the mandatory cooling floor.'))
		]);
		panels.hardware = E('div', {
			'class': 'pwm-fan-panel',
			'role': 'tabpanel',
			'id': 'pwm-fan-settings-panel-hardware',
			'aria-labelledby': 'pwm-fan-settings-tab-hardware'
		}, [
			fanComponents.card(_('Monitoring inputs'), hardwareFields),
			fanComponents.card(_('Detected hardware'), hardwareBody),
			fanComponents.card(_('Advanced device matching'), advancedFields)
		]);

		var tabLabels = {
			general: _('General'),
			mode: _('Mode'),
			hardware: _('Hardware')
		};
		var tabNode = fanComponents.tabs(tabLabels, 'general', selectTab,
			'pwm-fan-settings');
		self.tabButtons = {};
		tabNode.querySelectorAll('button').forEach(function(button, index) {
			self.tabButtons[Object.keys(tabLabels)[index]] = button;
		});

		activeTab = 'general';
		applyDiagnostics(config.diagnostics);
		var structuralDiagnostics = (config.diagnostics || []).filter(function(item) {
			return item.severity === 'error' && !fields[item.key];
		});
		var diagnosticSummary = structuralDiagnostics.length ? fanComponents.card(
			_('Configuration errors'), E('div', { 'class': 'pwm-fan-error' },
				structuralDiagnostics.map(function(item) {
					var location = item.line ? _('Line %d').format(item.line) : _('Configuration');
					return E('p', {}, [
						E('strong', {}, [ location + ': ' ]),
						item.message || item.code,
						item.value ? E('code', {}, [ ' ' + item.value ]) : ''
					]);
				}))) : '';
		updateVisibility();
		settingsReady = true;
		poll.add(function() {
			if (document.hidden || draft.mode === 'disabled' ||
				activeTab === 'general' ||
				(activeTab === 'mode' && draft.mode !== 'curve'))
				return Promise.resolve();
			var now = Date.now();
			var interval = activeTab === 'mode' ? 2000 : 5000;
			if (now < nextStatusPoll)
				return Promise.resolve();
			nextStatusPoll = now + interval;
			return refreshStatus();
		}, 2);
		var resetConfiguration = E('button', {
			'class': 'btn cbi-button cbi-button-negative',
			'type': 'button',
			'click': function() {
				ui.showModal(_('Reset configuration?'), [
					E('p', {}, [
						_('All tuning will be replaced with the current defaults and the operating mode will become Kernel. History and logs remain. This cannot be automatically undone.')
					]),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]),
						' ',
						E('button', {
							'class': 'btn cbi-button-negative',
							'click': function() {
								return fan.resetConfig(self.configRevision).then(function(result) {
									if (!result.reset) {
										ui.hideModal();
										if (result.error === 'config_changed') {
											ui.addNotification(null, E('p', {}, [
												_('The configuration changed outside LuCI. The current configuration will be reloaded; confirm the reset again if it is still wanted.')
											]), 'warning');
											window.location.reload();
										}
										else {
											ui.addNotification(null, E('p', {}, [
												_('The configuration could not be reset.')
											]), 'danger');
										}
										return;
									}
									return fan.serviceAction('restart').then(function(service) {
										if (!service.success) {
											ui.hideModal();
											ui.addNotification(null, E('p', {}, [
												_('The configuration was reset, but the controller could not restart.')
											]), 'danger');
											return;
										}
										window.location.reload();
									});
								});
							}
						}, [ _('Reset Configuration') ])
					])
				]);
			}
		}, [ _('Reset Configuration') ]);

		if (readOnly) {
			[ panels.general, panels.mode, panels.hardware ].forEach(function(panel) {
				panel.querySelectorAll('input, select, button').forEach(function(control) {
					control.disabled = true;
				});
			});
			resetConfiguration.disabled = true;
		}

		return E([], [
			fanComponents.stylesheet(),
			E('div', { 'class': 'pwm-fan', 'data-page': 'settings' }, [
				compatibility || '',
				diagnosticSummary,
				tabNode,
				panels.general,
				panels.mode,
				panels.hardware,
				E('div', { 'class': 'pwm-fan-destructive-action' }, [ resetConfiguration ])
			])
		]);
	},

	saveDraft: function(apply) {
		var self = this;
		if (!this.settingsReady)
			return Promise.reject(new Error(_('Wait until the settings finish loading.')));
		if (fanComponents.hasCompatibilityError(this.status))
			return Promise.reject(new Error(
				_('Install the matching controller package before you change the configuration.')));
		var candidate = controllerConfig(this.draft);
		var activeModem = this.status.modem || {};
		var restartRequired = candidate.hwmon_name !== this.activeHardware.hwmon_name ||
			candidate.thermal_zone !== this.activeHardware.thermal_zone ||
			candidate.modem_source !== (activeModem.source || 'off') ||
			candidate.modem_http_host !== activeModem.host ||
			candidate.modem_at_device !== activeModem.device ||
			+candidate.modem_interval_s !== +activeModem.interval_s ||
			(this.status.modes && this.status.modes.active === 'disabled' &&
				candidate.mode !== 'disabled');
		return fan.validateConfig(candidate).then(function(validation) {
			if (!validation.valid) {
				self.applyDiagnostics(validation.diagnostics);
				var diagnostic = validation.diagnostics && validation.diagnostics[0];
				throw new Error(diagnostic && (diagnostic.message || diagnostic.code) ||
					_('The configuration is invalid.'));
			}
			return fan.saveConfig(candidate, self.configRevision);
		}).then(function(result) {
			if (!result.saved) {
				var message = result.error === 'config_changed'
					? _('The configuration changed outside LuCI. Reload this page before saving.')
					: result.error || _('The configuration could not be saved.');
				throw new Error(message);
			}
			self.configRevision = result.config_revision;
			if (!apply)
				return result;
			return fan.serviceAction(restartRequired ? 'restart' : 'reload').then(function(service) {
				if (!service.success)
					throw new Error(
						_('The configuration was saved, but the controller could not apply it.'));
				self.activeHardware = {
					hwmon_name: candidate.hwmon_name,
					thermal_zone: candidate.thermal_zone
				};
				self.setAppliedMode(candidate.mode);
				return result;
			});
		});
	},

	handleSave: function() {
		return this.saveDraft(false);
	},

	handleSaveApply: function() {
		return this.saveDraft(true);
	},

	handleReset: function() {
		if (!this.settingsReady)
			return Promise.resolve();
		window.location.reload();
		return Promise.resolve();
	}
});
