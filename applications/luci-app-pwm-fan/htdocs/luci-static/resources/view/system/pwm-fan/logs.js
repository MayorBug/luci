// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require dom';
'require poll';
'require pwm.fan as fan';
'require pwm.fan_format as fanFormat';
'require pwm.fan_components as fanComponents';
'require ui';
'require uci';
'require view';
/* global fan fanFormat fanComponents */

function entryKey(entry, index) {
	return [ entry.timestamp, entry.code, index ].join(':');
}

function renderEntries(logs, filter, openKeys) {
	var entries = logs && Array.isArray(logs.entries)
		? logs.entries.map(function(entry, index) {
			return { entry: entry, index: index };
		}).reverse() : [];
	if (filter !== 'all')
		entries = entries.filter(function(item) {
			return item.entry.level === filter;
		});
	if (!entries.length)
		return E('div', { 'class': 'pwm-fan-empty' }, [
			filter === 'all'
				? _('No fan-controller events recorded this boot.')
				: _('No events match this filter.')
		]);

	return E('div', { 'class': 'pwm-fan-log-list' },
		entries.map(function(item) {
			var entry = item.entry;
			var key = entryKey(entry, item.index);
			return E('details', {
				'class': 'pwm-fan-log-entry ' + (entry.level || 'info'),
				'data-event-key': key,
				'open': openKeys && openKeys[key] ? '' : null
			}, [
				E('summary', {}, [
					fanComponents.badge(fanFormat.eventLevel(entry.level),
						entry.level === 'info' ? '' : entry.level),
					E('div', {}, [
						E('strong', {}, [ fanFormat.eventName(entry.code) ]),
						E('div', { 'class': 'pwm-fan-muted' }, [
							fanFormat.formatDateTime(entry.timestamp)
						])
					])
				]),
				E('div', { 'class': 'pwm-fan-log-detail' }, [
					fanFormat.formatEventDetails(entry)
				])
			]);
		}));
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
		var logs = { entries: [] };
		var loaded = false;
		var filter = 'all';
		var body = E('div', {}, [
			E('div', { 'class': 'pwm-fan-muted' }, [ _('Loading events…') ])
		]);
		var filters = fanComponents.filters({
			all: _('All'),
			info: _('Information'),
			warning: _('Warnings'),
			error: _('Errors')
		}, filter, function(value) {
			filter = value;
			if (loaded)
				dom.content(body, renderEntries(logs, filter, {}));
		});
		function update(updated) {
			var openKeys = {};
			body.querySelectorAll('details[open][data-event-key]').forEach(function(node) {
				openKeys[node.getAttribute('data-event-key')] = true;
			});
			logs = updated;
			loaded = true;
			dom.content(body, renderEntries(updated, filter, openKeys));
		}
		var clearButton = E('button', {
			'class': 'btn cbi-button-negative pwm-fan-log-clear',
			'type': 'button',
			'click': function() {
				ui.showModal(_('Clear displayed events?'), [
					E('p', {}, [ _('This hides earlier PWM Fan events. It does not delete OpenWrt system logs.') ]),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]),
						' ',
						E('button', {
							'class': 'btn cbi-button-negative',
							'click': function() {
								return fan.clearLogs().then(function(result) {
									if (!result || result.cleared !== true)
										throw new Error(_('Displayed events could not be cleared.'));
									return fan.loadLogs();
								}).then(function(updated) {
									update(updated);
									ui.hideModal();
								}).catch(function(error) {
									ui.addNotification(null, E('p', {}, [ error.message || error ]));
								});
							}
						}, [ _('Clear displayed events') ])
					])
				]);
			},
			'aria-label': _('Clear displayed events')
		}, [
			E('span', { 'class': 'pwm-fan-log-clear-full' }, [ _('Clear displayed events') ]),
			E('span', { 'class': 'pwm-fan-log-clear-short' }, [ _('Clear') ])
		]);

		poll.add(function() {
			if (document.hidden || !loaded)
				return Promise.resolve();
			return fan.loadLogs().then(function(updated) {
				update(updated);
			});
		}, 30);
		requestAnimationFrame(function() {
			Promise.all([ systemPromise, fan.loadLogs() ]).then(function(data) {
				update(data[1]);
			}).catch(function() {
				loaded = true;
				dom.content(body, E('div', { 'class': 'pwm-fan-error' }, [
					_('Controller events could not be loaded.')
				]));
			});
		});

		return E([], [
			fanComponents.stylesheet(),
			E('div', { 'class': 'pwm-fan', 'data-page': 'logs' }, [
				fanComponents.card(_('Controller events'), E('div', {}, [
					E('div', { 'class': 'pwm-fan-log-toolbar' }, [ filters ]),
					body
				]), clearButton)
			])
		]);
	}
});
