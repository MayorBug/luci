// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';
'require pwm.fan_svg as fanSvg';
'require pwm.fan_ui as fanUi';
'require ui';
/* global fanSvg fanUi */

var svgElement = fanSvg.element;
var numeric = fanSvg.numeric;

function parseCurve(points) {
	var values = Array.isArray(points) ? points : points ? [ points ] : [];
	return values.map(function(point) {
		var match = String(point).match(/^(\d+):(\d+)$/);
		return match ? { temperature: +match[1], percent: +match[2] } : null;
	}).filter(function(point) {
		return point != null;
	}).sort(function(a, b) {
		return a.temperature - b.temperature;
	});
}

function parseKernelPolicy(policy) {
	var points = policy && Array.isArray(policy.points) ? policy.points : [];

	return points.map(function(point) {
		var temperature = numeric(point.trip_temperature_millic);
		var pwm = numeric(point.pwm);
		if (temperature == null)
			temperature = numeric(point.temperature);
		var percent = pwm == null ? numeric(point.percent)
			: Math.round(pwm * 100 / 255);
		return temperature == null || percent == null ? null : {
			temperature: temperature / 1000,
			percent: percent,
			pwm: pwm,
			state: point.state,
			hysteresis_millic: point.hysteresis_millic,
			release_temperature_millic: point.release_temperature_millic
		};
	}).filter(function(point) {
		return point != null;
	}).sort(function(a, b) {
		return a.temperature - b.temperature;
	});
}

function stepCurvePath(points, width, height) {
	var left = 60, right = width - 20, top = 20, bottom = height - 45;
	var path = 'M%d %d '.format(left, bottom);
	var current = 0;

	points.forEach(function(point) {
		var x = left + (point.temperature - 20) / 105 * (right - left);
		var y = bottom - point.percent / 100 * (bottom - top);
		path += 'L%.1f %.1f L%.1f %.1f '.format(x,
			bottom - current / 100 * (bottom - top), x, y);
		current = point.percent;
	});
	path += 'L%d %.1f'.format(right,
		bottom - current / 100 * (bottom - top));
	return path;
}

function curveTangents(points) {
	var tangents = points.map(function() { return 0; });
	var slopes = [];

	if (points.length < 2)
		return tangents;
	for (var i = 0; i < points.length - 1; i++)
		slopes[i] = (points[i + 1].percent - points[i].percent) /
			(points[i + 1].temperature - points[i].temperature);
	tangents[0] = slopes[0];
	tangents[points.length - 1] = slopes[slopes.length - 1];
	for (var j = 1; j < points.length - 1; j++) {
		if (slopes[j - 1] !== 0 && slopes[j] !== 0 &&
			slopes[j - 1] * slopes[j] > 0)
			tangents[j] = 2 / (1 / slopes[j - 1] + 1 / slopes[j]);
	}
	for (var k = 0; k < slopes.length; k++) {
		if (slopes[k] === 0) {
			tangents[k] = 0;
			tangents[k + 1] = 0;
			continue;
		}
		var a = tangents[k] / slopes[k];
		var b = tangents[k + 1] / slopes[k];
		var sum = a * a + b * b;
		if (sum > 9) {
			var scale = 3 / Math.sqrt(sum);
			tangents[k] = scale * a * slopes[k];
			tangents[k + 1] = scale * b * slopes[k];
		}
	}
	return tangents;
}

function evaluateCurve(curve, style, temperatureMillic) {
	var values = Array.isArray(curve) ? curve : String(curve || '').split(',');
	var points = parseCurve(values);
	var wanted = +temperatureMillic / 1000;

	if (!points.length || !isFinite(wanted))
		return null;
	if (style !== 'smooth') {
		var requested = 0;
		points.forEach(function(point) {
			if (wanted >= point.temperature)
				requested = point.percent;
		});
		return requested;
	}
	if (wanted <= points[0].temperature)
		return points[0].percent;
	if (wanted >= points[points.length - 1].temperature)
		return points[points.length - 1].percent;
	var tangents = curveTangents(points);
	for (var i = 0; i < points.length - 1; i++) {
		if (wanted > points[i + 1].temperature)
			continue;
		var span = points[i + 1].temperature - points[i].temperature;
		var position = (wanted - points[i].temperature) / span;
		var h00 = 2 * position * position * position -
			3 * position * position + 1;
		var h10 = position * position * position -
			2 * position * position + position;
		var h01 = -2 * position * position * position +
			3 * position * position;
		var h11 = position * position * position - position * position;
		var result = h00 * points[i].percent + h10 * span * tangents[i] +
			h01 * points[i + 1].percent + h11 * span * tangents[i + 1];
		return Math.round(clamp(result, points[i].percent,
			points[i + 1].percent));
	}
	return null;
}

function smoothCurvePath(points, width, height) {
	var left = 60, right = width - 20, top = 20, bottom = height - 45;

	if (!points.length)
		return 'M%d %d L%d %d'.format(left, bottom, right, bottom);
	var firstY = bottom - points[0].percent / 100 * (bottom - top);
	var path = 'M%d %.1f '.format(left, firstY);
	var tangents = curveTangents(points);
	var previous;

	points.forEach(function(point, index) {
		var x = left + (point.temperature - 20) / 105 * (right - left);
		var y = bottom - point.percent / 100 * (bottom - top);
		if (index === 0) {
			path += 'L%.1f %.1f '.format(x, y);
		}
		else {
			var previousX = left +
				(previous.temperature - 20) / 105 * (right - left);
			var previousY = bottom -
				previous.percent / 100 * (bottom - top);
			var third = (x - previousX) / 3;
			var temperatureThird = (point.temperature -
				previous.temperature) / 3;
			var previousControlY = previousY -
				tangents[index - 1] * temperatureThird / 100 *
				(bottom - top);
			var nextControlY = y +
				tangents[index] * temperatureThird / 100 *
				(bottom - top);
			path += 'C%.1f %.1f %.1f %.1f %.1f %.1f '.format(
				previousX + third, previousControlY,
				x - third, nextControlY, x, y);
		}
		previous = point;
	});
	path += 'L%d %.1f'.format(right,
		bottom - points[points.length - 1].percent / 100 * (bottom - top));
	return path;
}

function curveValues(points) {
	return points.map(function(point) {
		return '%d:%d'.format(point.temperature, point.percent);
	});
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function createCurveEditor(curve, kernelPolicy, options) {
	options = options || {};
	var width = 840, height = 310;
	var left = 64, right = width - 24, top = 24, bottom = height - 50;
	var svg = svgElement('svg', {
		'class': 'pwm-fan-curve-svg',
		viewBox: '0 0 ' + width + ' ' + height,
		role: 'application',
		'aria-label': _('Interactive fan curve editor'),
		style: 'display:block;width:100%;height:auto;touch-action:none;user-select:none'
	});
	var percentages = [ 0, 25, 50, 75, 100 ];
	var temperatures = [ 20, 40, 60, 80, 100, 125 ];
	var plotBackground = svgElement('rect', {
		x: left, y: top, width: right - left, height: bottom - top,
		fill: 'transparent'
	});
	svg.appendChild(plotBackground);

	percentages.forEach(function(percent) {
		var y = bottom - percent / 100 * (bottom - top);
		svg.appendChild(svgElement('line', {
			x1: left, y1: y, x2: right, y2: y,
			style: 'stroke:currentColor;stroke-opacity:.2;stroke-width:1;stroke-dasharray:3 5;pointer-events:none'
		}));
		svg.appendChild(svgElement('text', {
			x: left - 10, y: y + 5, 'text-anchor': 'end',
			style: 'fill:currentColor;font-size:14px;pointer-events:none'
		}, percent + '%'));
	});

	temperatures.forEach(function(temperature) {
		var x = left + (temperature - 20) / 105 * (right - left);
		svg.appendChild(svgElement('line', {
			x1: x, y1: top, x2: x, y2: bottom,
			style: 'stroke:currentColor;stroke-opacity:.12;stroke-width:1;stroke-dasharray:3 5;pointer-events:none'
		}));
		svg.appendChild(svgElement('text', {
			x: x, y: bottom + 20,
			'text-anchor': temperature === 20 ? 'start' :
				temperature === 125 ? 'end' : 'middle',
			style: 'fill:currentColor;font-size:14px;pointer-events:none'
		}, temperature + '°C'));
	});

	svg.appendChild(svgElement('text', {
		x: (left + right) / 2, y: height - 4, 'text-anchor': 'middle',
		style: 'fill:currentColor;font-size:13px;opacity:.8;pointer-events:none'
	}, _('Temperature')));
	var requested = svgElement('path', {
		fill: 'none', stroke: '#3498db', 'stroke-width': '4',
		'vector-effect': 'non-scaling-stroke',
		'pointer-events': 'none'
	});
	var floor = svgElement('path', {
		fill: 'none', stroke: '#e74c3c', 'stroke-width': '4',
		'stroke-dasharray': '9 6',
		'vector-effect': 'non-scaling-stroke',
		'pointer-events': 'none'
	});
	svg.appendChild(requested);
	svg.appendChild(floor);
	var policyDetails = svgElement('g', { 'class': 'pwm-fan-policy-details' });
	var liveMarkers = svgElement('g', { 'class': 'pwm-fan-live-markers' });
	svg.appendChild(policyDetails);
	svg.appendChild(liveMarkers);
	var handles = svgElement('g', {});
	svg.appendChild(handles);
	var editHelp = _('Choose Edit to change the curve. Drag points to adjust them, right-click a point to edit or remove it, or right-click empty chart space to add one. Choose Save to finish editing; changes take effect only after Save & Apply.');
	var editButton = E('button', {
		'class': 'btn cbi-button',
		'type': 'button',
		'aria-pressed': 'false'
	}, [ _('Edit points') ]);
	var pointReadout = E('output', {
		'class': 'pwm-fan-curve-readout',
		'aria-live': 'polite'
	});
	var chartWrap = E('div', {
		'class': 'pwm-fan-curve-chart'
	}, [ svg, pointReadout ]);
	var editor = {
		node: E('div', { 'class': 'pwm-fan-curve-body' }, [
			E('div', { 'class': 'pwm-fan-curve-toolbar' }, [
				E('div', {
					'class': 'pwm-fan-curve-legends'
				}, [
					fanUi.help(
						_('Fan output requested by the configured temperature curve.'), [
						E('span', {
							'class': 'pwm-fan-curve-key requested'
						}),
						_('Requested curve')
					]),
					fanUi.help(
						_('Read-only cooling levels and trip temperatures supplied by the device tree and enforced as the minimum output.'), [
						E('span', {
							'class': 'pwm-fan-curve-key floor'
						}),
						_('Kernel minimum')
					])
				]),
				E('div', { 'class': 'pwm-fan-curve-actions' }, [
					fanUi.help(editHelp, [ editButton ])
				])
			]),
			chartWrap
		]),
		requested: requested,
		floor: floor,
		handles: handles,
		points: parseCurve(curve),
		kernelPolicy: kernelPolicy,
		status: options.status || null,
		style: options.style === 'smooth' ? 'smooth' : 'step',
		editMode: false,
		dragged: false
	};

	function updatePointReadout(point, ev) {
		if (!point) {
			pointReadout.textContent = '';
			pointReadout.classList.remove('active');
			return;
		}

		pointReadout.textContent = _('%d °C · %d%%').format(
			point.temperature, point.percent);
		pointReadout.classList.add('active');

		var box = chartWrap.getBoundingClientRect();
		if (!box.width || !box.height)
			return;
		var x = ev && ev.clientX != null
			? ev.clientX - box.left
			: (left + (point.temperature - 20) / 105 * (right - left)) /
				width * box.width;
		var y = ev && ev.clientY != null
			? ev.clientY - box.top
			: (bottom - point.percent / 100 * (bottom - top)) /
				height * box.height;
		var tipWidth = pointReadout.offsetWidth;
		var tipHeight = pointReadout.offsetHeight;
		var tipLeft = x + 12;
		var tipTop = y - tipHeight - 12;

		if (tipLeft + tipWidth > box.width - 4)
			tipLeft = x - tipWidth - 12;
		if (tipTop < 4)
			tipTop = y + 12;
		pointReadout.style.left = Math.max(4, tipLeft) + 'px';
		pointReadout.style.top = Math.min(box.height - tipHeight - 4,
			Math.max(4, tipTop)) + 'px';
	}

	function coordinatesForEvent(ev) {
		var box = svg.getBoundingClientRect();
		return {
			x: (ev.clientX - box.left) * width / box.width,
			y: (ev.clientY - box.top) * height / box.height
		};
	}

	function valuesForCoordinates(position) {
		return {
			temperature: clamp(Math.round(20 +
				(position.x - left) / (right - left) * 105), 20, 125),
			percent: clamp(Math.round((bottom - position.y) /
				(bottom - top) * 100), 0, 100)
		};
	}

	function markChanged() {
		editor.node.dispatchEvent(new CustomEvent('widget-change', {
			bubbles: true,
			detail: { value: editor.getValue() }
		}));
		if (typeof options.onchange === 'function')
			options.onchange(editor.getValue());
	}

	function setEditMode(enabled) {
		editor.editMode = !!enabled;
		editButton.setAttribute('aria-pressed',
			editor.editMode ? 'true' : 'false');
		editButton.classList.toggle('cbi-button-positive', editor.editMode);
		editButton.textContent = editor.editMode ? _('Done') : _('Edit points');
		svg.style.cursor = editor.editMode ? 'context-menu' : 'default';
		updatePointReadout(null);
		renderHandles();
	}

	function validateCandidate(index, temperature, percent) {
		var previous = index > 0 ? editor.points[index - 1] : null;
		var next = index < editor.points.length - 1
			? editor.points[index + 1] : null;

		if (!isFinite(temperature) || !isFinite(percent))
			return _('Temperature and fan output must be numbers.');
		if (temperature < 20 || temperature > 125)
			return _('Temperature must be between 20 and 125 °C.');
		if (percent < 0 || percent > 100)
			return _('Fan output must be between 0 and 100%.');
		if (previous && temperature <= previous.temperature)
			return _('Temperature must be higher than the previous point.');
		if (next && temperature >= next.temperature)
			return _('Temperature must be lower than the next point.');
		if (previous && percent < previous.percent)
			return _('Output must not be lower than the previous point.');
		if (next && percent > next.percent)
			return _('Output must not be higher than the next point.');
		return true;
	}

	function editPoint(index) {
		var point = editor.points[index];
		var temperature = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			min: 20,
			max: 125,
			step: 1,
			value: point.temperature
		});
		var percent = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			min: 0,
			max: 100,
			step: 1,
			value: point.percent
		});
		var error = E('p', {
			'class': 'cbi-value-description',
			style: 'color:#d9534f'
		});

		ui.showModal(_('Edit fan curve point'), [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Temperature') ]),
				E('div', { 'class': 'cbi-value-field' }, [ temperature, ' °C' ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Fan output') ]),
				E('div', { 'class': 'cbi-value-field' }, [ percent, ' %' ])
			]),
			error,
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'type': 'button',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-positive',
					'type': 'button',
					'click': function() {
						var newTemperature = Math.round(+temperature.value);
						var newPercent = Math.round(+percent.value);
						var valid = validateCandidate(index,
							newTemperature, newPercent);
						if (valid !== true) {
							error.textContent = valid;
							return;
						}
						point.temperature = newTemperature;
						point.percent = newPercent;
						renderEditable();
						markChanged();
						ui.hideModal();
					}
				}, [ _('Apply to form') ])
			])
		]);
		temperature.focus();
	}

	function pointActions(index) {
		var point = editor.points[index];
		ui.showModal(_('%d °C at %d%%').format(
			point.temperature, point.percent), [
			E('p', {}, [
				_('Changes remain pending until you use Save & Apply.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'type': 'button',
					'click': function() {
						ui.hideModal();
						editPoint(index);
					}
				}, [ _('Edit') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-negative',
					'type': 'button',
					disabled: editor.points.length <= 2 ? 'disabled' : null,
					'title': editor.points.length <= 2
						? fanUi.formatTooltip(
							_('At least two points are required.')) : '',
					'click': function() {
						if (editor.points.length <= 2)
							return;
						editor.points.splice(index, 1);
						renderEditable();
						markChanged();
						ui.hideModal();
					}
				}, [ _('Remove') ]),
				' ',
				E('button', {
					'class': 'btn',
					'type': 'button',
					'click': ui.hideModal
				}, [ _('Cancel') ])
			])
		]);
	}

	function pointForPosition(position) {
		var values = valuesForCoordinates(position);
		var index = 0;

		while (index < editor.points.length &&
			editor.points[index].temperature < values.temperature)
			index++;
		if (index < editor.points.length &&
			editor.points[index].temperature === values.temperature)
			return null;

		var previous = index > 0 ? editor.points[index - 1] : null;
		var next = index < editor.points.length ? editor.points[index] : null;
		values.percent = clamp(values.percent,
			previous ? previous.percent : 0,
			next ? next.percent : 100);
		values.index = index;
		return values;
	}

	function addPointActions(position) {
		var values = pointForPosition(position);
		var atMaximum = editor.points.length >= 10;

		ui.showModal(_('Add fan curve point'), [
			E('p', {}, [
				atMaximum
					? _('The curve already has the maximum of ten points.')
					: values == null
						? _('A point already exists at this temperature.')
						: _('%d °C at %d%% fan output').format(
							values.temperature, values.percent)
			]),
			E('p', { 'class': 'cbi-value-description' }, [
				_('The output is constrained between the neighbouring points. You can fine-tune it after adding.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'type': 'button',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-positive',
					'type': 'button',
					disabled: atMaximum || values == null
						? 'disabled' : null,
					'click': function() {
						if (atMaximum || values == null)
							return;
						editor.points.splice(values.index, 0, {
							temperature: values.temperature,
							percent: values.percent
						});
						renderEditable();
						markChanged();
						ui.hideModal();
					}
				}, [ _('Add point') ])
			])
		]);
	}

	function dragPoint(index, ev) {
		if (!editor.editMode)
			return;
		if (ev.button != null && ev.button !== 0)
			return;
		ev.preventDefault();
		var start = coordinatesForEvent(ev);
		editor.dragged = false;

		function move(moveEvent) {
			var position = coordinatesForEvent(moveEvent);
			if (Math.abs(position.x - start.x) > 2 ||
				Math.abs(position.y - start.y) > 2)
				editor.dragged = true;
			if (!editor.dragged)
				return;

			var values = valuesForCoordinates(position);
			var previous = index > 0 ? editor.points[index - 1] : null;
			var next = index < editor.points.length - 1
				? editor.points[index + 1] : null;
			values.temperature = clamp(values.temperature,
				previous ? previous.temperature + 1 : 20,
				next ? next.temperature - 1 : 125);
			values.percent = clamp(values.percent,
				previous ? previous.percent : 0,
				next ? next.percent : 100);
			editor.points[index] = values;
			renderEditable();
			updatePointReadout(editor.points[index], moveEvent);
		}

		function finish() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', finish);
			if (editor.dragged)
				markChanged();
			else
				pointActions(index);
			editor.dragged = false;
			updatePointReadout(null);
		}

		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', finish);
	}

	function renderCurve() {
		editor.requested.setAttribute('d',
			(editor.style === 'smooth' ? smoothCurvePath : stepCurvePath)(
				editor.points, width, height));
	}

	function renderPolicy() {
		var policyPoints = parseKernelPolicy(editor.kernelPolicy);
		editor.floor.setAttribute('d',
			stepCurvePath(policyPoints, width, height));
		while (policyDetails.firstChild)
			policyDetails.removeChild(policyDetails.firstChild);
		policyPoints.forEach(function(point) {
			var x = left + (point.temperature - 20) / 105 * (right - left);
			var y = bottom - point.percent / 100 * (bottom - top);
			var release = point.release_temperature_millic == null ? null
				: point.release_temperature_millic / 1000;
			if (release != null) {
				var releaseX = left + (release - 20) / 105 * (right - left);
				policyDetails.appendChild(svgElement('line', {
					x1: releaseX, y1: top, x2: releaseX, y2: bottom,
					style: 'stroke:#e74c3c;stroke-opacity:.28;stroke-width:1;stroke-dasharray:3 5;pointer-events:none'
				}));
			}
			var marker = svgElement('circle', {
				cx: x, cy: y, r: 4, fill: '#e74c3c', tabindex: '0',
				role: 'img',
				'aria-label': _('Kernel state %s, raw PWM %s, %s%%, trip %s °C, hysteresis %s °C, release %s °C')
					.format(point.state, point.pwm, point.percent,
						point.temperature,
						(point.hysteresis_millic || 0) / 1000,
						release == null ? '?' : release)
			});
			marker.appendChild(svgElement('title', {}, marker.getAttribute('aria-label')));
			policyDetails.appendChild(marker);
		});
	}

	function renderLiveMarkers() {
		while (liveMarkers.firstChild)
			liveMarkers.removeChild(liveMarkers.firstChild);
		var raw = editor.status && editor.status.raw || {};
		if (raw.filtered_temperature_millic != null) {
			var liveTemperature = raw.filtered_temperature_millic / 1000;
			var liveX = left + (liveTemperature - 20) / 105 * (right - left);
			liveMarkers.appendChild(svgElement('line', {
				x1: liveX, y1: top, x2: liveX, y2: bottom,
				style: 'stroke:#f39c12;stroke-width:2;stroke-opacity:.8;pointer-events:none'
			}));
			[
				[ raw.kernel_floor_pwm, '#e74c3c', _('Current kernel floor') ],
				[ raw.actual_pwm, '#2ecc71', _('Current actual output') ]
			].forEach(function(item) {
				if (item[0] == null)
					return;
				var percent = Math.round(item[0] * 100 / 255);
				var markerY = bottom - percent / 100 * (bottom - top);
				var marker = svgElement('circle', {
					cx: liveX, cy: markerY, r: 6, fill: item[1],
					stroke: 'white', 'stroke-width': 2, role: 'img',
					'aria-label': _('%s at %.1f °C: raw PWM %d (%d%%)')
						.format(item[2], liveTemperature, item[0], percent)
				});
				marker.appendChild(svgElement('title', {}, marker.getAttribute('aria-label')));
				liveMarkers.appendChild(marker);
			});
		}
	}

	function renderHandles() {
		while (handles.firstChild)
			handles.removeChild(handles.firstChild);

		editor.points.forEach(function(point, index) {
			var x = left + (point.temperature - 20) / 105 * (right - left);
			var y = bottom - point.percent / 100 * (bottom - top);
			var group = svgElement('g', {
				'class': 'pwm-fan-curve-point',
				tabindex: editor.editMode ? '0' : '-1',
				role: 'button',
				'aria-label': editor.editMode
					? _('%d °C at %d%%. Drag or activate for actions.')
						.format(point.temperature, point.percent)
					: _('%d °C at %d%%.').format(
						point.temperature, point.percent),
				style: editor.editMode ? 'cursor:grab' : 'cursor:default'
			});
			group.appendChild(svgElement('circle', {
				cx: x, cy: y, r: 8,
				fill: '#3498db', stroke: 'white', 'stroke-width': 2,
				'vector-effect': 'non-scaling-stroke'
			}));
			group.addEventListener('pointerenter', function(ev) {
				if (ev.pointerType !== 'touch')
					updatePointReadout(point, ev);
			});
			group.addEventListener('pointermove', function(ev) {
				if (ev.pointerType !== 'touch')
					updatePointReadout(point, ev);
			});
			group.addEventListener('pointerleave', function() {
				if (!editor.dragged)
					updatePointReadout(null);
			});
			group.addEventListener('focus', function() {
				updatePointReadout(point);
			});
			group.addEventListener('blur', function() {
				updatePointReadout(null);
			});
			group.addEventListener('pointerdown', dragPoint.bind(null, index));
			group.addEventListener('contextmenu', function(ev) {
				if (!editor.editMode)
					return;
				ev.preventDefault();
				ev.stopPropagation();
				pointActions(index);
			});
			group.addEventListener('keydown', function(ev) {
				if (editor.editMode &&
					(ev.key === 'Enter' || ev.key === ' ' ||
					ev.key === 'ContextMenu')) {
					ev.preventDefault();
					pointActions(index);
				}
			});
			handles.appendChild(group);
		});
	}

	function renderEditable() {
		renderCurve();
		renderHandles();
	}

	function renderAll() {
		renderCurve();
		renderPolicy();
		renderLiveMarkers();
		renderHandles();
	}

	editButton.addEventListener('click', function() {
		setEditMode(!editor.editMode);
	});
	svg.addEventListener('contextmenu', function(ev) {
		if (!editor.editMode)
			return;
		var position = coordinatesForEvent(ev);
		if (position.x < left || position.x > right ||
			position.y < top || position.y > bottom)
			return;
		ev.preventDefault();
		addPointActions(position);
	});

	editor.getValue = function() {
		return curveValues(editor.points);
	};
	editor.setValue = function(points) {
		editor.points = parseCurve(points);
		renderEditable();
	};
	editor.updateKernelPolicy = function(newKernelPolicy) {
		editor.kernelPolicy = newKernelPolicy;
		renderPolicy();
	};
	editor.updateStatus = function(status) {
		editor.status = status;
		renderLiveMarkers();
	};
	editor.setStyle = function(style) {
		editor.style = style === 'smooth' ? 'smooth' : 'step';
		renderCurve();
	};
	renderAll();
	return editor;
}

return baseclass.extend({
	create: createCurveEditor,
	evaluate: evaluateCurve
});
