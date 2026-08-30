// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';

var SVG_NS = 'http://www.w3.org/2000/svg';

return baseclass.extend({
	element: function(name, attributes, text) {
		var element = document.createElementNS(SVG_NS, name);

		Object.keys(attributes || {}).forEach(function(attribute) {
			element.setAttribute(attribute, attributes[attribute]);
		});
		if (text != null)
			element.appendChild(document.createTextNode(text));
		return element;
	},

	numeric: function(value) {
		if (value == null || value === '')
			return null;
		value = +value;
		return isFinite(value) ? value : null;
	}
});
