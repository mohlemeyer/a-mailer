/*jslint sloppy:true, white:true, vars:true */
/*global require */

/**
 * Starter script for the A-Mailer module
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var container = require('vertx/container');

if (!container.config.hasOwnProperty('test') ||
        container.config.test === true) {
    // Run unit tests per default: Either when the config "test" property
    // is not specified or it is set to true.
    require('jslibs/a-mailer/test/runTests');
} else {
    // Otherwise simply start the module
    require('jslibs/a-mailer/lib/a-mailer');
}
