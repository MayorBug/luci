// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';
'require dom';
'require pwm.fan_format as fanFormat';
'require pwm.fan_svg as fanSvg';
'require ui';
/* global fanFormat fanSvg */

var MAX_HISTORY_SAMPLES = 24 * 60;
var METRIC_STORAGE_KEY = 'pwm-fan.graph.metric';
var SERIES_STORAGE_KEY = 'pwm-fan.graph.series';
var WINDOW_STORAGE_KEY = 'pwm-fan.graph.window';
var METRICS = [ 'setpoint', 'rpm' ];
var SERIES = [ 'setpoint', 'rpm', 'temperature', 'modemTemperature' ];
var WINDOWS = [ 'all', '0.25', '0.5', '1', '3', '6', '12', '24' ];
var WIDTH = 1000;
var HEIGHT = 340;
var LEFT = 60;
var RIGHT = 940;
var TOP = 20;
var BOTTOM = 280;
var GAP_SECONDS = 150;

var svgElement = fanSvg.element;
var numeric = fanSvg.numeric;

function graphHours(history) {
	var hours = history ? +history.hours : 6;
	return isFinite(hours) && hours >= 1 && hours <= 24 ? hours : 6;
}

function storedMetric() {
	var metric;
	try {
		metric = window.localStorage.getItem(METRIC_STORAGE_KEY);
	}
	catch (e) {}
	return METRICS.indexOf(metric) !== -1 ? metric : 'setpoint';
}

function saveMetric(metric) {
	try {
		window.localStorage.setItem(METRIC_STORAGE_KEY, metric);
	}
	catch (e) {}
}

function storedSeriesVisibility() {
	var stored;
	var visibility = {};

	SERIES.forEach(function(series) {
		visibility[series] = true;
	});
	try {
		stored = JSON.parse(window.localStorage.getItem(SERIES_STORAGE_KEY));
	}
	catch (e) {}
	if (stored && typeof stored === 'object') {
		SERIES.forEach(function(series) {
			if (typeof stored[series] === 'boolean')
				visibility[series] = stored[series];
		});
	}
	return visibility;
}

function saveSeriesVisibility(visibility) {
	try {
		window.localStorage.setItem(SERIES_STORAGE_KEY,
			JSON.stringify(visibility));
	}
	catch (e) {}
}

function storedWindow() {
	var windowValue;
	try {
		windowValue = window.localStorage.getItem(WINDOW_STORAGE_KEY);
	}
	catch (e) {}
	return WINDOWS.indexOf(windowValue) !== -1 ? windowValue : 'all';
}

function saveWindow(windowValue) {
	try {
		window.localStorage.setItem(WINDOW_STORAGE_KEY, windowValue);
	}
	catch (e) {}
}

function displayHours(graph) {
	return graph.window === 'all' ? graph.hours : +graph.window;
}

function historySamples(history) {
	if (!history || !Array.isArray(history.samples))
		return [];

	return history.samples.map(function(sample) {
		return {
			timestamp: numeric(sample.timestamp),
			temperature: sample.temperature == null ? null :
				numeric(sample.temperature / 1000),
			modemTemperature: sample.modem_temperature == null ? null :
				numeric(sample.modem_temperature / 1000),
			setpoint: numeric(sample.setpoint),
			rpm: numeric(sample.rpm)
		};
	}).filter(function(sample) {
		return sample.timestamp != null;
	}).sort(function(a, b) {
		return a.timestamp - b.timestamp;
	}).slice(-MAX_HISTORY_SAMPLES);
}

function visibleSamples(graph) {
	var samples = graph.samples.slice(-MAX_HISTORY_SAMPLES);
	if (graph.current != null) {
		if (samples.length && samples[samples.length - 1].timestamp ===
			graph.current.timestamp)
			samples[samples.length - 1] = graph.current;
		else
			samples.push(graph.current);
	}
	if (samples.length === 0)
		return [];

	var now = graph.current != null
		? graph.current.timestamp
		: samples[samples.length - 1].timestamp;
	var start = now - displayHours(graph) * 3600;

	return samples.filter(function(sample) {
		return sample.timestamp >= start && sample.timestamp <= now;
	});
}

function coordinates(samples, field, maximum, now, seconds) {
	var start = now - seconds;
	return samples.map(function(sample) {
		var value = sample[field];
		if (value == null)
			return null;
		value = Math.max(0, Math.min(maximum, value));
		return {
			timestamp: sample.timestamp,
			x: LEFT + ((sample.timestamp - start) / seconds * (RIGHT - LEFT)),
			y: BOTTOM - (value / maximum * (BOTTOM - TOP))
		};
	});
}

function linePath(points) {
	var path = '';
	var previous = null;

	points.forEach(function(point) {
		if (point == null) {
			previous = null;
			return;
		}
		var command = previous == null ||
			point.timestamp - previous.timestamp > GAP_SECONDS ? 'M' : 'L';
		path += '%s%.1f %.1f '.format(command, point.x, point.y);
		previous = point;
	});
	return path;
}

function areaPath(points) {
	var path = '';
	var segment = [];

	function closeSegment() {
		if (segment.length === 0)
			return;
		path += 'M%.1f %d '.format(segment[0].x, BOTTOM);
		segment.forEach(function(point) {
			path += 'L%.1f %.1f '.format(point.x, point.y);
		});
		path += 'L%.1f %d Z '.format(segment[segment.length - 1].x, BOTTOM);
		segment = [];
	}

	points.forEach(function(point) {
		if (point == null ||
			(segment.length && point.timestamp -
				segment[segment.length - 1].timestamp > GAP_SECONDS)) {
			closeSegment();
		}
		if (point != null)
			segment.push(point);
	});
	closeSegment();
	return path;
}

function roundedMaximum(value, padding, step) {
	return Math.max(step, Math.ceil((value + padding) / step) * step);
}

function metricName(metric) {
	switch (metric) {
	case 'rpm': return _('Fan speed');
	default: return _('Output');
	}
}

function metricUnit(metric) {
	return metric === 'rpm' ? ' RPM' : '%';
}

function clockLabel(timestamp) {
	return fanFormat.formatClock(timestamp);
}

function updateAxes(graph, temperatureMaximum, metricMaximum, now,
		metricVisible, temperatureVisible) {
	for (var i = 0; i <= 4; i++) {
		var fraction = 1 - i / 4;
		graph.leftLabels[i].textContent = metricVisible
			? Math.round(metricMaximum * fraction) + metricUnit(graph.metric)
			: '';
		graph.rightLabels[i].textContent = temperatureVisible
			? Math.round(temperatureMaximum * fraction) + '°C'
			: '';
	}
	var hours = displayHours(graph);
	var start = now - hours * 3600;
	graph.timeLabels[0].textContent = clockLabel(start);
	graph.timeLabels[1].textContent = clockLabel(start + hours * 1800);
	graph.timeLabels[2].textContent = clockLabel(now);
}

function updateSummary(graph, samples) {
	if (!graph.seriesVisible[graph.metric]) {
		graph.summary.textContent = '';
		return;
	}
	var values = samples.map(function(sample) {
		return sample[graph.metric];
	}).filter(function(value) {
		return value != null;
	});

	if (values.length === 0) {
		graph.summary.textContent = _('No %s samples in this period').format(
			metricName(graph.metric).toLowerCase());
		return;
	}
	var minimum = Math.min.apply(null, values);
	var maximum = Math.max.apply(null, values);
	var average = values.reduce(function(total, value) {
		return total + value;
	}, 0) / values.length;
	var unit = metricUnit(graph.metric);
	graph.summary.textContent =
		_('Minimum: %s%s · Average: %s%s · Maximum: %s%s').format(
			Math.round(minimum), unit, Math.round(average), unit,
			Math.round(maximum), unit);
}

function drawGraph(graph) {
	var samples = visibleSamples(graph);
	graph.visibleSamples = samples;
	var metricVisible = graph.seriesVisible[graph.metric];
	var cpuVisible = graph.seriesVisible.temperature;
	var modemVisible = graph.modemEnabled &&
		graph.seriesVisible.modemTemperature;
	var temperatureVisible = cpuVisible || modemVisible;

	if (samples.length === 0) {
		graph.temperatureLine.setAttribute('d', '');
		graph.modemTemperatureLine.setAttribute('d', '');
		graph.metricArea.setAttribute('d', '');
		graph.summary.textContent = metricVisible
			? _('No history samples yet') : '';
		return;
	}
	var now = graph.current != null
		? graph.current.timestamp
		: samples[samples.length - 1].timestamp;
	var temperatures = [];
	if (cpuVisible) {
		temperatures = samples.map(function(sample) {
			return sample.temperature;
		}).filter(function(value) {
			return value != null;
		});
	}
	if (modemVisible) {
		temperatures = temperatures.concat(samples.map(function(sample) {
			return sample.modemTemperature;
		}).filter(function(value) {
			return value != null;
		}));
	}
	var metricValues = metricVisible
		? samples.map(function(sample) {
			return sample[graph.metric];
		}).filter(function(value) {
			return value != null;
		}) : [];
	var temperaturePeak = temperatures.length
		? Math.max.apply(null, temperatures) : 0;
	var metricPeak = metricValues.length
		? Math.max.apply(null, metricValues) : 0;
	var temperatureMaximum = roundedMaximum(temperaturePeak, 10, 5);
	var metricMaximum = graph.metric === 'rpm'
		? roundedMaximum(metricPeak, 1000, 1000) : 100;
	var seconds = displayHours(graph) * 3600;

	updateAxes(graph, temperatureMaximum, metricMaximum, now,
		metricVisible, temperatureVisible);
	graph.temperatureLine.setAttribute('d', cpuVisible
		? linePath(coordinates(samples, 'temperature',
			temperatureMaximum, now, seconds)) : '');
	graph.modemTemperatureLine.setAttribute('d', modemVisible
		? linePath(coordinates(samples, 'modemTemperature',
			temperatureMaximum, now, seconds)) : '');
	graph.metricArea.setAttribute('d', metricVisible
		? areaPath(coordinates(samples, graph.metric,
			metricMaximum, now, seconds)) : '');
	updateSummary(graph, samples);
}

function updateLegendState(legend, visible) {
	legend.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

function toggleSeries(graph, series) {
	graph.seriesVisible[series] = !graph.seriesVisible[series];
	saveSeriesVisibility(graph.seriesVisible);
	updateLabels(graph);
	drawGraph(graph);
}

function bindLegend(graph, legend, series) {
	function activate(ev) {
		if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ')
			return;
		if (ev.type === 'keydown')
			ev.preventDefault();
		toggleSeries(graph, typeof series === 'function' ? series() : series);
	}

	legend.addEventListener('click', activate);
	legend.addEventListener('keydown', activate);
}

function createGraph(history) {
	var svg = svgElement('svg', {
		viewBox: '0 0 ' + WIDTH + ' ' + HEIGHT,
		role: 'application',
		tabindex: '0',
		'aria-label': _('Fan and temperature history'),
		style: 'display:block;width:100%;height:auto;max-height:340px'
	});
	var leftLabels = [];
	var rightLabels = [];

	for (var i = 0; i <= 4; i++) {
		var y = TOP + (BOTTOM - TOP) * i / 4;
		svg.appendChild(svgElement('line', {
			x1: LEFT, y1: y, x2: RIGHT, y2: y,
			style: 'stroke:currentColor;stroke-opacity:.15;stroke-width:1'
		}));
		leftLabels.push(svgElement('text', {
			x: LEFT - 10, y: y + 6, 'text-anchor': 'end',
			style: 'fill:currentColor;font-size:18px'
		}));
		rightLabels.push(svgElement('text', {
			x: RIGHT + 10, y: y + 6, 'text-anchor': 'start',
			style: 'fill:currentColor;font-size:18px'
		}));
		svg.appendChild(leftLabels[i]);
		svg.appendChild(rightLabels[i]);
	}

	var timeLabels = [ LEFT, (LEFT + RIGHT) / 2, RIGHT ].map(function(x, i) {
		var label = svgElement('text', {
			x: x, y: HEIGHT - 25,
			'text-anchor': i === 0 ? 'start' : i === 1 ? 'middle' : 'end',
			style: 'fill:currentColor;font-size:18px'
		});
		svg.appendChild(label);
		return label;
	});
	var metricArea = svgElement('path', {
		fill: '#3498db', 'fill-opacity': '0.5', stroke: 'none'
	});
	var temperatureLine = svgElement('path', {
		fill: 'none', stroke: '#e67e22', 'stroke-width': '3',
		'vector-effect': 'non-scaling-stroke'
	});
	var modemTemperatureLine = svgElement('path', {
		fill: 'none', stroke: '#9b59b6', 'stroke-width': '3',
		'vector-effect': 'non-scaling-stroke'
	});
	svg.appendChild(metricArea);
	svg.appendChild(temperatureLine);
	svg.appendChild(modemTemperatureLine);
	var hoverLine = svgElement('line', {
		x1: LEFT, y1: TOP, x2: LEFT, y2: BOTTOM,
		style: 'display:none;stroke:currentColor;stroke-opacity:.55;stroke-width:1;stroke-dasharray:4 4;pointer-events:none'
	});
	svg.appendChild(hoverLine);

	var setpointOption = E('option', { value: 'setpoint' }, [ _('Fan output') ]);
	var rpmOption = E('option', { value: 'rpm' }, [ _('Fan speed (RPM)') ]);
	var selector = E('select', { 'class': 'cbi-input-select' }, [
		setpointOption, rpmOption
	]);
	selector.value = storedMetric();
	var metricLabel = E('span');
	var temperatureLabel = E('span');
	var modemTemperatureLabel = E('span');
	var metricLegend = E('span', {
		'role': 'button',
		'tabindex': '0',
		'class': 'pwm-fan-legend',
		style: '--pwm-legend-color:#3498db'
	}, [ metricLabel ]);
	var temperatureLegend = E('span', {
		'role': 'button',
		'tabindex': '0',
		'class': 'pwm-fan-legend',
		style: '--pwm-legend-color:#e67e22'
	}, [ temperatureLabel ]);
	var modemTemperatureLegend = E('span', {
		'role': 'button',
		'tabindex': '0',
		'class': 'pwm-fan-legend',
		style: 'display:none;--pwm-legend-color:#9b59b6'
	}, [ modemTemperatureLabel ]);
	var windowSelector = E('select', { 'class': 'cbi-input-select' }, [
		E('option', { value: 'all' }, [ _('All recorded') ]),
		E('option', { value: '0.25' }, [ _('15 minutes') ]),
		E('option', { value: '0.5' }, [ _('30 minutes') ]),
		E('option', { value: '1' }, [ _('1 hour') ]),
		E('option', { value: '3' }, [ _('3 hours') ]),
		E('option', { value: '6' }, [ _('6 hours') ]),
		E('option', { value: '12' }, [ _('12 hours') ]),
		E('option', { value: '24' }, [ _('24 hours') ])
	]);
	windowSelector.value = storedWindow();
	var summary = E('div', { 'class': 'pwm-fan-muted' });
	var chartTip = E('div', {
		'class': 'pwm-fan-chart-tip',
		'aria-hidden': 'true'
	});
	var chartWrap = E('div', { 'class': 'pwm-fan-chart-wrap' }, [
		svg, chartTip
	]);
	var graph = {
		node: E('div', { 'class': 'pwm-fan-history' }, [
			E('div', {
				'class': 'pwm-fan-history-toolbar'
			}, [
				E('label', {
					'class': 'pwm-fan-history-control plot'
				}, [ _('Plot: '), selector ]),
				E('div', { 'class': 'pwm-fan-history-legends' }, [
					metricLegend,
					temperatureLegend,
					modemTemperatureLegend
				]),
				E('label', {
					'class': 'pwm-fan-history-control window'
				}, [
					_('Window: '), windowSelector
				])
			]),
			chartWrap,
			summary
		]),
		hours: graphHours(history),
		window: windowSelector.value,
		metric: selector.value,
		samples: historySamples(history),
		current: null,
		modemEnabled: false,
		seriesVisible: storedSeriesVisibility(),
		metricArea: metricArea,
		temperatureLine: temperatureLine,
		modemTemperatureLine: modemTemperatureLine,
		metricLabel: metricLabel,
		temperatureLabel: temperatureLabel,
		modemTemperatureLabel: modemTemperatureLabel,
		metricLegend: metricLegend,
		temperatureLegend: temperatureLegend,
		modemTemperatureLegend: modemTemperatureLegend,
		summary: summary,
		leftLabels: leftLabels,
		rightLabels: rightLabels,
		timeLabels: timeLabels,
		selector: selector,
		windowSelector: windowSelector,
		rpmOption: rpmOption
	};
	graph.svg = svg;
	graph.chartWrap = chartWrap;
	graph.chartTip = chartTip;
	graph.hoverLine = hoverLine;
	graph.hoverIndex = null;

	function hideTip() {
		graph.hoverIndex = null;
		graph.chartTip.classList.remove('open');
		graph.chartTip.setAttribute('aria-hidden', 'true');
		graph.hoverLine.style.display = 'none';
	}

	function showTip(index) {
		var samples = graph.visibleSamples || [];
		if (!samples.length)
			return hideTip();
		index = Math.max(0, Math.min(samples.length - 1, index));
		var sample = samples[index];
		var now = graph.current != null
			? graph.current.timestamp
			: samples[samples.length - 1].timestamp;
		var seconds = displayHours(graph) * 3600;
		var x = LEFT + (sample.timestamp - (now - seconds)) / seconds *
			(RIGHT - LEFT);
		x = Math.max(LEFT, Math.min(RIGHT, x));
		graph.hoverIndex = index;
		graph.hoverLine.setAttribute('x1', x);
		graph.hoverLine.setAttribute('x2', x);
		graph.hoverLine.style.display = '';
		dom.content(graph.chartTip, [
			E('strong', {}, [
				fanFormat.formatDateTime(sample.timestamp)
			]),
			E('span', {}, [
				_('Fan %s').format(sample[graph.metric] == null
					? _('not available')
					: Math.round(sample[graph.metric]) +
						metricUnit(graph.metric))
			]),
			E('span', {}, [
				_('Router CPU %s').format(sample.temperature == null
					? _('not available')
					: '%.1f °C'.format(sample.temperature))
			]),
			graph.modemEnabled ? E('span', {}, [
				_('Modem %s').format(sample.modemTemperature == null
					? _('not available')
					: '%.1f °C'.format(sample.modemTemperature))
			]) : ''
		]);
		graph.chartTip.style.left =
			Math.max(5, Math.min(78, x / WIDTH * 100)) + '%';
		graph.chartTip.style.top = '1rem';
		graph.chartTip.classList.add('open');
		graph.chartTip.setAttribute('aria-hidden', 'false');
	}

	svg.addEventListener('pointermove', function(ev) {
		var samples = graph.visibleSamples || [];
		if (!samples.length)
			return;
		var box = svg.getBoundingClientRect();
		var x = (ev.clientX - box.left) * WIDTH / box.width;
		if (x < LEFT || x > RIGHT)
			return hideTip();
		var now = graph.current != null
			? graph.current.timestamp
			: samples[samples.length - 1].timestamp;
		var timestamp = now - displayHours(graph) * 3600 +
			(x - LEFT) / (RIGHT - LEFT) * displayHours(graph) * 3600;
		var nearest = 0;
		for (var i = 1; i < samples.length; i++)
			if (Math.abs(samples[i].timestamp - timestamp) <
				Math.abs(samples[nearest].timestamp - timestamp))
				nearest = i;
		showTip(nearest);
	});
	svg.addEventListener('pointerleave', hideTip);
	svg.addEventListener('focus', function() {
		showTip((graph.visibleSamples || []).length - 1);
	});
	svg.addEventListener('blur', hideTip);
	svg.addEventListener('keydown', function(ev) {
		if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' &&
			ev.key !== 'Home' && ev.key !== 'End')
			return;
		ev.preventDefault();
		var last = (graph.visibleSamples || []).length - 1;
		if (last < 0)
			return;
		if (ev.key === 'Home')
			graph.hoverIndex = 0;
		else if (ev.key === 'End' || graph.hoverIndex == null)
			graph.hoverIndex = last;
		else
			graph.hoverIndex += ev.key === 'ArrowLeft' ? -1 : 1;
		showTip(graph.hoverIndex);
	});
	selector.addEventListener('change', function() {
		graph.metric = selector.value;
		saveMetric(graph.metric);
		updateLabels(graph);
		drawGraph(graph);
	});
	windowSelector.addEventListener('change', function() {
		graph.window = windowSelector.value;
		saveWindow(graph.window);
		updateLabels(graph);
		drawGraph(graph);
	});
	bindLegend(graph, metricLegend, function() {
		return graph.metric;
	});
	bindLegend(graph, temperatureLegend, 'temperature');
	bindLegend(graph, modemTemperatureLegend, 'modemTemperature');
	updateLabels(graph);
	drawGraph(graph);
	return graph;
}

function setTachEnabled(graph, enabled) {
	graph.rpmOption.disabled = !enabled;
	if (!enabled && graph.metric === 'rpm') {
		graph.metric = 'setpoint';
		graph.selector.value = graph.metric;
		saveMetric(graph.metric);
		updateLabels(graph);
		drawGraph(graph);
	}
}

function setModemEnabled(graph, enabled) {
	enabled = !!enabled;
	if (graph.modemEnabled === enabled)
		return;
	graph.modemEnabled = enabled;
	graph.modemTemperatureLegend.style.display =
		graph.modemEnabled ? '' : 'none';
	updateLabels(graph);
	drawGraph(graph);
}

function updateLabels(graph) {
	var samples = visibleSamples(graph);
	var current = graph.current != null
		? graph.current
		: samples.length ? samples[samples.length - 1] : null;

	updateLegendState(graph.metricLegend,
		graph.seriesVisible[graph.metric]);
	updateLegendState(graph.temperatureLegend,
		graph.seriesVisible.temperature);
	updateLegendState(graph.modemTemperatureLegend,
		graph.seriesVisible.modemTemperature);
	var value = current == null ? null : current[graph.metric];
	var metricText = value == null
		? _('%s: not available').format(metricName(graph.metric))
		: _('%s: %d%s').format(metricName(graph.metric), Math.round(value),
			metricUnit(graph.metric));
	var metricCompact = value == null
		? (graph.metric === 'rpm' ? _('RPM —') : _('Output —'))
		: graph.metric === 'rpm'
			? _('RPM %d').format(Math.round(value))
			: _('Output %d%%').format(Math.round(value));
	graph.metricLabel.textContent = metricText;
	graph.metricLegend.setAttribute('data-compact', metricCompact);
	graph.metricLegend.setAttribute('aria-label', metricText);
	var temperature = current == null ? null : current.temperature;
	var temperatureText = temperature == null
		? _('Router CPU: not available')
		: _('Router CPU: %.1f °C').format(temperature);
	graph.temperatureLabel.textContent = temperatureText;
	graph.temperatureLegend.setAttribute('data-compact',
		temperature == null ? _('CPU —')
			: _('CPU %.1f°C').format(temperature));
	graph.temperatureLegend.setAttribute('aria-label', temperatureText);
	if (graph.modemEnabled) {
		var modemTemperature = current == null
			? null : current.modemTemperature;
		var modemText =
			modemTemperature == null
				? _('Modem: not available')
				: _('Modem: %.1f °C').format(modemTemperature);
		graph.modemTemperatureLabel.textContent = modemText;
		graph.modemTemperatureLegend.setAttribute('data-compact',
			modemTemperature == null ? _('Modem —')
				: _('Modem %.1f°C').format(modemTemperature));
		graph.modemTemperatureLegend.setAttribute('aria-label', modemText);
	}
}

function setHistory(graph, history) {
	graph.hours = graphHours(history);
	graph.samples = historySamples(history);
	updateLabels(graph);
	drawGraph(graph);
}

function updateCurrent(graph, status, setpoint) {
	var hardware = status.hardware || {};
	var thermal = hardware.thermal || {};
	var tach = hardware.tach || {};
	var modem = status.modem || {};
	if (!hardware.available || status.timestamp == null ||
		!(status.service && status.service.running)) {
		graph.current = null;
		updateLabels(graph);
		return;
	}
	graph.current = {
		timestamp: status.timestamp,
		temperature: thermal.temperature_millic == null ? null :
			thermal.temperature_millic / 1000,
		modemTemperature: modem.temperature_millic == null ? null :
			modem.temperature_millic / 1000,
		setpoint: numeric(setpoint),
		rpm: numeric(tach.rpm)
	};
	updateLabels(graph);
}

return baseclass.extend({
	create: createGraph,
	setHistory: setHistory,
	updateCurrent: updateCurrent,
	setTachEnabled: setTachEnabled,
	setModemEnabled: setModemEnabled
});
