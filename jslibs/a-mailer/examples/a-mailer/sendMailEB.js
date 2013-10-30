/*jslint sloppy:true, white:true, stupid:true */
/*global require, Packages */

/**
 * Simple usage of A-Mailer as a Vert.x module
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var vertx = require('vertx');
var container = require('vertx/container');
var console = require('vertx/console');

var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

// Set up debugging output
vertx.eventBus.registerHandler('mailerDbgOut', function (msg) {
    console.log('MAILER DEBUG: ' + msg);
});

// Create the email JSON structure
var email = {
        from: 'Sender Name <sender.name@domain.com>',
        to: ['Recipient_1 <rec.ipient1@domain1.com>', 'rec.ipient2@domain2.com'],
        cc: 'Recipient_3 <rec.ipient3@domain3.com>',
        subject: 'My Subject',
        content_type: 'text/html',
        body: '<h1>This is my email body.</h1>'
};

// Add multiple attachments
email.attachments = [];
var attachmentData = DatatypeConverter.printBase64Binary(
        vertx.fileSystem.readFileSync(
                'jslibs/a-mailer/examples/a-mailer/attachment.pdf').getBytes());
email.attachments.push({
    data: attachmentData,
    mimeType: 'application/pdf',
    fileName: 'pdfAttachment.pdf'
});
attachmentData = DatatypeConverter.printBase64Binary(
        vertx.fileSystem.readFileSync(
                'jslibs/a-mailer/examples/a-mailer/attachment.txt').getBytes());
email.attachments.push({
    data: attachmentData,
    mimeType: 'text/plain; charset=utf-8',
    fileName: 'txtAttachment.txt'
});

// Send the email
vertx.eventBus.send('mailer', JSON.stringify(email), function (replyJSON) {
    var reply = JSON.parse(replyJSON);

    if (reply.errorMsg) {
        console.log('ERROR SENDING MAIL: ' + reply.errorMsg);
    } else {
        console.log('SERVER RESPONSE: ' + reply.response);
        console.log('FAILED RECIPIENTS: ' + reply.rcptFailedAdrs);
    }
    console.log('\nEXITING...');
    container.exit();
});