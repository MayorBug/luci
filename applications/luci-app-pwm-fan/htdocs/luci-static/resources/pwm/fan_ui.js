// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';

var TOOLTIP_LINE_LENGTH = 70;

function formatTooltip(text) {
	return String(text || '').split('\n').map(function(paragraph) {
		var words = paragraph.trim().split(/\s+/);
		var lines = [];
		var line = '';

		words.forEach(function(word) {
			if (line && line.length + word.length + 1 > TOOLTIP_LINE_LENGTH) {
				lines.push(line);
				line = word;
			}
			else {
				line += (line ? ' ' : '') + word;
			}
		});
		if (line)
			lines.push(line);
		return lines.join('\n');
	}).join('\n');
}

function help(text, content) {
	return E('span', {
		'class': 'pwm-fan-help',
		'title': formatTooltip(text),
		'tabindex': '0',
		'aria-label': text,
		style: 'cursor:help'
	}, content);
}

return baseclass.extend({
	help: help,
	formatTooltip: formatTooltip
});
