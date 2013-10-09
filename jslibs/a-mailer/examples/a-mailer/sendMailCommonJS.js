/*jslint sloppy:true, white:true */
/*global require */

/**
 * Simple usage of A-Mailer as a CommonJS module
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var console = require('vertx/console');
var container = require('vertx/container');
var aMailer = require('jslibs/a-mailer/lib/a-mailer');

var mailer = aMailer.getMailer({
    host: 'your_mail_host',
    port: 'mail_host_port'
        // and maybe more configuration options. See docs.
});

var email = {
        from: 'Sender Name <sender.name@domain.com>',
        to: ['Recipient_1 <rec.ipient1@domain1.com>', 'rec.ipient2@domain2.com'],
        cc: 'Recipient_3 <rec.ipient3@domain3.com>',
        subject: 'My Subject',
        body: 'This is my email body.'
};

mailer.send(email, function (err, result) {
    if (err) {
        console.log('ERROR SENDING MAIL: ' + err.toString());
    } else {
        console.log('SERVER RESPONSE: ' + result.response);
        console.log('FAILED RECIPIENTS: ' + result.rcptFailedAdrs);
    }
    console.log('\nEXITING...');
    container.exit();
});
