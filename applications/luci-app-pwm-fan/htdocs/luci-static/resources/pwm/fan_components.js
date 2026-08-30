// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';

var SVG_NS = 'http://www.w3.org/2000/svg';
var STYLE_REVISION = '5';
var ICON_PATHS = {
	cpu: 'M9 9h6v6H9z M9 2v3 M12 2v3 M15 2v3 M9 19v3 M12 19v3 M15 19v3 M2 9h3 M2 12h3 M2 15h3 M19 9h3 M19 12h3 M19 15h3 M6 6h12v12H6z',
	modem: 'M5 13h14a2 2 0 0 1 2 2v4H3v-4a2 2 0 0 1 2-2z M8 16h.01 M12 16h.01 M12 13V5 M8.5 8.5a5 5 0 0 1 7 0 M6 6a8.5 8.5 0 0 1 12 0',
	shield: 'M12 3l7 3v5c0 4.6-2.9 8.2-7 10-4.1-1.8-7-5.4-7-10V6l7-3z M9 12l2 2 4-4',
	mode: 'M4 17l5-5 3 3 7-8 M16 7h3v3',
	thermal: 'M12 3a3 3 0 0 0-3 3v8.2a5 5 0 1 0 6 0V6a3 3 0 0 0-3-3z M12 8v8'
};

function stylesheet() {
	return E('link', {
		'rel': 'stylesheet',
		'href': L.resource('pwm/fan.css') + '?v=' + STYLE_REVISION
	});
}

function icon(name) {
	var svg = document.createElementNS(SVG_NS, 'svg');
	var path = document.createElementNS(SVG_NS, 'path');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'pwm-fan-status-icon');
	svg.setAttribute('width', '24');
	svg.setAttribute('height', '24');
	path.setAttribute('d', ICON_PATHS[name]);
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	return svg;
}

function badge(text, state) {
	return E('span', {
		'class': 'pwm-fan-badge' + (state ? ' ' + state : '')
	}, [ text ]);
}

function card(title, body, actions, extraClass) {
	var content = [];

	if (title || actions)
		content.push(E('div', { 'class': 'pwm-fan-card-header' }, [
			title ? E('h3', { 'class': 'pwm-fan-card-title' }, [ title ]) : '',
			actions ? E('div', { 'class': 'pwm-fan-card-actions' },
				Array.isArray(actions) ? actions : [ actions ]) : ''
		]));

	content.push(body);

	return E('section', {
		'class': 'pwm-fan-card' + (extraClass ? ' ' + extraClass : '')
	}, content);
}

function metric(label, value, detail, kind, glyph) {
	return E('div', {
		'class': 'pwm-fan-metric' + (kind ? ' ' + kind : '')
	}, [
		E('span', {
			'class': 'pwm-fan-metric-icon',
			'aria-hidden': 'true'
		}, [ glyph || '•' ]),
		E('div', {}, [
			E('div', { 'class': 'pwm-fan-metric-label' }, [ label ]),
			E('div', { 'class': 'pwm-fan-metric-value' }, [ value ]),
			detail ? E('div', {
				'class': 'pwm-fan-metric-detail'
			}, [ detail ]) : ''
		])
	]);
}

function tabs(items, active, onchange, prefix) {
	var keys = Object.keys(items);
	var buttons = {};
	var node = E('div', { 'class': 'pwm-fan-tabs', role: 'tablist' });
	prefix = prefix || 'pwm-fan';

	function select(key, focus) {
		if (buttons[key].disabled)
			return;
		keys.forEach(function(name) {
			var selected = name === key;
			buttons[name].classList.toggle('active', selected);
			buttons[name].setAttribute('aria-selected',
				selected ? 'true' : 'false');
			buttons[name].setAttribute('tabindex', selected ? '0' : '-1');
		});
		onchange(key);
		if (focus)
			buttons[key].focus();
	}

	keys.forEach(function(key) {
		var button = E('button', {
			'type': 'button',
			'role': 'tab',
			'id': prefix + '-tab-' + key,
			'aria-controls': prefix + '-panel-' + key,
			'class': key === active ? 'active' : '',
			'aria-selected': key === active ? 'true' : 'false',
			'tabindex': key === active ? '0' : '-1',
			'click': function() {
				select(key, false);
			},
			'keydown': function(event) {
				var enabled = keys.filter(function(name) {
					return !buttons[name].disabled;
				});
				var position = enabled.indexOf(key);
				var target;
				if (event.key === 'ArrowRight')
					target = enabled[(position + 1) % enabled.length];
				else if (event.key === 'ArrowLeft')
					target = enabled[(position + enabled.length - 1) % enabled.length];
				else if (event.key === 'Home')
					target = enabled[0];
				else if (event.key === 'End')
					target = enabled[enabled.length - 1];
				else
					return;
				event.preventDefault();
				select(target, true);
			}
		}, [ items[key] ]);
		buttons[key] = button;
		node.appendChild(button);
	});
	return node;
}

function filters(items, active, onchange) {
	var buttons = {};
	var node = E('div', {
		'class': 'pwm-fan-filters',
		'role': 'group',
		'aria-label': _('Event severity')
	});

	Object.keys(items).forEach(function(key) {
		var button = E('button', {
			'type': 'button',
			'class': key === active ? 'active' : '',
			'aria-pressed': key === active ? 'true' : 'false',
			'click': function() {
				Object.keys(buttons).forEach(function(name) {
					var selected = name === key;
					buttons[name].classList.toggle('active', selected);
					buttons[name].setAttribute('aria-pressed',
						selected ? 'true' : 'false');
				});
				onchange(key);
			}
		}, [ items[key] ]);
		buttons[key] = button;
		node.appendChild(button);
	});
	return node;
}

function hasCompatibilityError(status) {
	return status && (status.error === 'unsupported_contract' ||
		status.error === 'incompatible_controller_status');
}

function compatibilityPanel(status) {
	if (!hasCompatibilityError(status))
		return null;
	return card(_('Controller update required'), E('div', {
		'class': 'pwm-fan-recovery'
	}, [
		E('p', {}, [
			_('The installed pwm-fan-control package does not match this LuCI app.')
		]),
		E('p', {}, [
			_('Install the matching controller package. Resetting the configuration will not fix this mismatch.')
		])
	]));
}

return baseclass.extend({
	stylesheet: stylesheet,
	icon: icon,
	badge: badge,
	card: card,
	metric: metric,
	tabs: tabs,
	filters: filters,
	hasCompatibilityError: hasCompatibilityError,
	compatibilityPanel: compatibilityPanel
});
