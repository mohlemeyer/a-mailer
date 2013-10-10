/*jslint sloppy:true, white:true, vars:true, plusplus: true, unparam: true */
/*global require, Packages, exports, Mailer */

/**
 * An easy to use module to send email messages via SMTP asynchronously.<br>
 * <br>
 * This module can be used in two modes:
 * <ul>
 * <li>As a <b>CommonJS module</b>: Include this module as a resource in your
 * Vert.x project by specifying
 * <code>var a_mailer = require('jslibs/a-mailer/lib/a-mailer');</code>
 * in your JavaScript file.</li>
 * <li>As a <b>runnable Vert.x module</b>: Deploy as a Vert.x module and send
 * your email messages on the event bus.</li>
 * </ul>
 * In both cases the module or a mailer object retrieved by the
 * <code>getMailer</code> method needs some configuration to work properly:
 * <ul>
 * <li><code>address</code> {string} Event bus address on which the module is
 * listening for send requests. Only required when the module is used as a
 * runnable Vert.x module.</li>
 * <li><code>host</code> {string} SMTP server host</li>
 * <li><code>port</code> {integer} SMTP server port</li>
 * <li><code>ssl</code> {boolean} If set to <code>true</code> uses an encrypted
 * connection to the server right from the start. Often combined with
 * <code>port</code> set to 465, e.g. in the case of Gmail. Default is
 * <code>false</code>.</li>
 * <li><code>auth</code> {boolean} Set to <code>true</code> if the server
 * requires authentication. Default is <code>false</code>.</li>
 * <li><code>username</code> {string} Authentication user.</li>
 * <li><code>password</code> {string} Authentication password.</li>
 * <li><code>content_type</code> {string} Default MIME type/subtype for the
 * email body; can be set to <code>text/html</code>. Every other or no value
 * will be interpreted as <code>text/plain</code>.</li>
 * </ul>
 * 
 * <b>NOTE on character encoding</b><br>
 * The email subject and body will always be encoded using UTF-8. If you use
 * the module from JavaScript and include non-US characters, make sure to
 * encode the source code file in UTF-8, too. Otherwise your email content
 * might get mangled.
 * 
 * @module jslibs/a-mailer/lib/a-mailer
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */

var vertx = require('vertx');
var container = require('vertx/container');
var getSmtpClient = require('jslibs/a-mailer/lib/client');

//Required java classes/packages
var MimeMessage = Packages.javax.mail.internet.MimeMessage;
var MailSession = Packages.javax.mail.Session;
var System = Packages.java.lang.System;
var InternetAddress = Packages.javax.mail.internet.InternetAddress;
var RecipientType = Packages.javax.mail.Message.RecipientType;
var ByteArrayOutputStream = Packages.java.io.ByteArrayOutputStream;
var JavaDate = Packages.java.util.Date;

/*
 * Only used to inject a client getter stub to support unit testing!
 */
exports.setClientGetter = function (clientGetter) {
    getSmtpClient = clientGetter;
};

/**
 * Retrieve a new mailer object<br>
 * <br>
 * Returns an individually configured (host and authentication data) mailer
 * object, with method(s) to send email messages.<br>
 * Currently the object has a single <code>send</code> method (see the
 * documentation for the inner <code>send</code> method of this module; it is
 * attached to the retrieved mailer object).
 * 
 * @param {object} configData Configuration data as mentioned in the module
 * description, except for the <code>address</code> property.
 * @returns {Mailer} A new mailer object.
 */
exports.getMailer = function (configData) {
        return new Mailer(configData);
}; // END: getMailer()

/**
 * Mailer object
 * 
 * @param {object} configData Configuration data as mentioned in the module
 * description, except for the <code>address</code> property.
 * 
 * @constructor
 */
function Mailer (configData) {
    if (!configData) {
        configData = {};
    }
    
    this.host = configData.host || 'localhost';
    this.port = configData.port || 25;
    this.ssl = configData.ssl || false;
    this.auth = configData.auth || false;
    this.username = this.auth ? configData.username : '';
    this.password = this.auth ? configData.password : '';
    this.textContentSubtype =
        configData.content_type === 'text/html' ? 'html' : 'plain';      
} // END: Mailer()

/**
 * Send an email.
 * 
 * @param {object} sendData Send data object
 * @param {string} sendData.from Sender email address
 * @param {string|array} sendData.to Single "TO" Recipient email address as a
 * string or an array of addresses
 * @param {string|array} [sendData.cc] Single "CC" Recipient email address as a
 * string or an array of addresses
 * @param {string|array} [sendData.bcc] Single "BCC" Recipient email address as
 * a string or an array of addresses
 * @param {string} sendData.subject Email subject
 * @param {string} [sendData.body=''] Email body
 * @param {string} [sendData.content_type] MIME type for this send request;
 * either <code>text/plain</code> or <code>text/html</code>. If otherwise
 * specified or not specified at all the configured MIME type for the module
 * will be used as the default value.
 * @param {function} [callback] Callback function; called after the email is
 * sent or when an error occurs. The first argument is either an error object
 * or null if everything went ok. In case of success the second argument is
 * a result object with up to two properties:
 * <ul>
 * <li><code>response</code> The server's response message.</li>
 * <li><code>rcptFailedAdrs</code> Array of email addresses, which were rejected
 * by the server.</li>
 * </ul>
 */
Mailer.prototype.send = function (sendData, callback) {
    var smtpClient;			// Underlying SMTP client
    var mailOpts;			// Mail client options
    var fromAddr;			// "from" address as a Java object
    var toAddrs;			// Array of "to" addresses as Java objects
    var ccAddrs;			// Array of "cc" addresses as Java objects
    var bccAddrs;			// Array of "bcc" addresses as Java objects
    var sendError;			// Error in the course of the send method
    var sendResult;			// Result of send operation
    var sendContentSubtype;	// MIME subtype for this send request


    // ===========
    // Initialize
    // ===========

    // Should be allowed to be called without callback
    callback = callback || function () {return;};
    sendError = null;
    sendResult = {};

    // ================
    // Check arguments
    // ================
    if (!sendData) {
        callback(new Error('a-mailer.send: Missing send data'));
        return;
    }
    if (!sendData.from) {
        callback(new Error('a-mailer.send: Missing "from" field'));
        return;
    }
    if (!sendData.to) {
        callback(new Error('a-mailer.send: Missing "to" field'));
        return;
    }
    if (!sendData.subject) {
        callback(new Error('a-mailer.send: Missing "subject" field'));
        return;
    }

    sendContentSubtype = this.textContentSubtype;
    if (sendData.content_type === 'text/html') {
        sendContentSubtype = 'html';
    } else if (sendData.content_type === 'text/plain') {
        sendContentSubtype = 'plain';
    }

    // ============================
    // Check sender and recipients
    // ============================

    /*
     * Parses a string or an array of strings into an array of Java
     * email addresses (javax.mail.internet.InternetAddress).
     */
    function parseAddresses (addrs) {
        var i, l;	// Loop vars
        var iAddrs;	// Array of Java internet addresses
        var retVal; // Return value

        if (typeof addrs === 'string') {
            // In case of a string, we expect a single address
            retVal = [InternetAddress.parse(addrs)[0]];
        } else {
            // Must be an array with potentially many address strings,
            // each representing a single address
            iAddrs = [];
            for (i = 0, l = addrs.length; i < l; i++) {
                iAddrs.push(InternetAddress.parse(addrs[i])[0]);
            }
            retVal = iAddrs;
        }
        
        return retVal;
    } // END: parseAddresses()

    try {
        fromAddr = InternetAddress.parse(sendData.from)[0];
    } catch (parseErr) {
        callback(new Error('a-mailer.send: Illegal "from" address: ' +
                parseErr.toString()));
        return;
    }
    try {
        toAddrs = parseAddresses(sendData.to);
        if (toAddrs.length === 0) {
            throw new Error('Missing "to" address');
        }
    } catch (parseErr) {
        callback(new Error('a-mailer.send: Illegal "to" address: ' +
                parseErr.toString()));
        return;		
    }
    try {
        ccAddrs = parseAddresses(sendData.cc || []);
    } catch (parseErr) {
        callback(new Error('a-mailer.send: Illegal "cc" address: ' +
                parseErr.toString()));
        return;		
    }
    try {
        bccAddrs = parseAddresses(sendData.bcc || []);
    } catch (parseErr) {
        callback(new Error('a-mailer.send: Illegal "bcc" address: ' +
                parseErr.toString()));
        return;		
    }

    // ===================
    // Set up mail client
    // ===================
    mailOpts = {
            ignoreTLS: true
    };
    if (this.auth) {
        mailOpts.auth = {};
        mailOpts.auth.user = this.username;
        mailOpts.auth.pass = this.password;
    }
    if (this.ssl) {
        mailOpts.secureConnection = true;
    }
    smtpClient = getSmtpClient(this.port, this.host, mailOpts);

    // =======================
    // Set exception handlers
    // =======================

    // Sets the "send error", which has a "toString" method
    // and optionally the properties "name", "data", "code".
    smtpClient.on('error', function(err){
        // "close" triggers the "end" handler
        sendError = err;
        smtpClient.close();
    });

    smtpClient.on('rcptFailed', function(failedAddresses){
        sendResult.rcptFailedAdrs = failedAddresses;
    });

    // ==========================
    // Set control flow handlers
    // ==========================
    smtpClient.once('idle', function () {
        var i, l;				// Loop vars
        var envelopeToAddrs;	// Array of "to" addresses for the envelope

        envelopeToAddrs = [];
        for (i = 0, l = toAddrs.length; i < l; i++) {
            envelopeToAddrs.push(toAddrs[i].getAddress());
        }
        for (i = 0, l = ccAddrs.length; i < l; i++) {
            envelopeToAddrs.push(ccAddrs[i].getAddress());
        }
        for (i = 0, l = bccAddrs.length; i < l; i++) {
            envelopeToAddrs.push(bccAddrs[i].getAddress());
        }

        smtpClient.useEnvelope({
            from: fromAddr.getAddress(),
            to: envelopeToAddrs
        });
    });

    smtpClient.on('message', function () {
        var message;	// The complete message: Header and body
        var msgBao;		// Intermediate ByteArrayOutputStream for the message

        try {
            message =new MimeMessage(MailSession.getInstance(System.getProperties()));
            message.setFrom(fromAddr);
            message.setRecipients(RecipientType.TO, toAddrs);
            if (ccAddrs.length > 0) {
                message.setRecipients(RecipientType.CC, ccAddrs);
            }
            if (bccAddrs.length > 0) {
                message.setRecipients(RecipientType.BCC, bccAddrs);
            }
            message.setSubject(sendData.subject, 'utf-8');
            message.setText(sendData.body || '', 'utf-8', sendContentSubtype);
            message.setSentDate(new JavaDate());
            msgBao = new ByteArrayOutputStream();
            message.writeTo(msgBao);
            smtpClient.end(new vertx.Buffer(msgBao.toByteArray()));
        } catch (msgError) {
            sendError = msgError;
            smtpClient.close();
        }
    });

    smtpClient.on('ready', function (success, response) {
        if (!success) {
            sendError = new Error(response);
        }
        sendResult.response = response;

        // "quit" triggers the "end" handler
        smtpClient.quit();
    });

    smtpClient.on('end', function () {
        callback(sendError, sendResult);
    });
}; // END: send()

//======================
// Event Bus Connection
//======================

//If we have an address, connect to the event  bus and make the "send" method
//available with roughly the same API
if (container.config.address) {
    vertx.eventBus.registerHandler(container.config.address,
    function (sendDataJSON, replier) {
        var data;       // Parsed message data
        var mailer;     // mailer object to send the email with

        try {
            data = JSON.parse(sendDataJSON);
        } catch (parseErr) {
            replier(JSON.stringify({
                errorMsg: 'JSON parse error: ' + parseErr.toString()
            }));
            return;
        }

        mailer = exports.getMailer(container.config);
        mailer.send(data, function (err, result) {
            if (err) {
                replier(JSON.stringify({
                    errorMsg: err.toString()
                }));
            } else {
                replier(JSON.stringify(result));
            }
        });
    });
}
