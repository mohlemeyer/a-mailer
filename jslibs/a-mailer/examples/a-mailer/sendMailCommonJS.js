/*jslint sloppy:true, white:true, stupid:true */
/*global require */

/**
 * Simple usage of A-Mailer as a CommonJS module
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var vertx = require('vertx');
var console = require('vertx/console');
var container = require('vertx/container');
var aMailer = require('jslibs/a-mailer/lib/a-mailer');

// Create a new mailer
var mailer = aMailer.getMailer({
    host: 'your_mail_host',
    auth: true,
    username: 'your_username',
    password: 'your_password',
    content_type: 'text/plain',
    sendTimeout: 10000,
    debug: true
});

// Set up debugging output
mailer.on('debug', function (msg) {
    console.log('DEBUG: ' + msg);
});

// Create the email object
var email = {
        from: 'Sender Name <sender.name@domain.com>',
        to: ['Recipient_1 <rec.ipient1@domain1.com>', 'rec.ipient2@domain2.com'],
        cc: 'Recipient_3 <rec.ipient3@domain3.com>',
        subject: 'My Subject',
        body: 'This is my email body.'
};

// Add multiple attachments
email.attachments = [];
var attachmentData = vertx.fileSystem.readFileSync(
        'jslibs/a-mailer/examples/a-mailer/attachment.pdf');
email.attachments.push({
    data: attachmentData,
    mimeType: 'application/pdf',
    fileName: 'pdfAttachment.pdf'
});
attachmentData = vertx.fileSystem.readFileSync(
        'jslibs/a-mailer/examples/a-mailer/attachment.txt');
email.attachments.push({
    data: attachmentData,
    mimeType: 'text/plain; charset=utf-8',
    fileName: 'txtAttachment.txt'
});

// Send the email
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
