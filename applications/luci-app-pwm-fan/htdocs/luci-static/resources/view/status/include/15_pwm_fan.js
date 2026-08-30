// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';
'require pwm.fan as fan';
'require pwm.fan_format as fanFormat';
/* global fan fanFormat */

return baseclass.extend({
	title: _('PWM Fan'),

	load: function() {
		return fan.load();
	},

	render: function(status) {
		return fanFormat.render(status);
	}
});
