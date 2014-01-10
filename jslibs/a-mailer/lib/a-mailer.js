/*jslint sloppy:true, white:true, vars:true, plusplus: true, unparam: true,
  nomen:true, todo:true */
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
 * your email messages through the event bus.</li>
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
 * main email body; can be set to <code>text/html</code>. Every other or no
 * value will be interpreted as <code>text/plain</code>. Character set encoding
 * specification as in <code>text/plain; charset=Cp1252</code> is NOT allowed
 * here, UTF-8 is always assumed for the main body.</li>
 * <li><code>sendTimeout</code> Max. time in ms for a <code>send</code>
 * or <code>sendSeq</code> operation to finish. Otherwise will result in an
 * error.</li>
 * <li><code>debug</code> {boolean} Enable debugging. With
 * <code>debug</code> set to true, the smtp client-server communication will be
 * sent to the "debug channel", implemented as an event handler on the Mailer
 * object in case of the CommonJS usage or as an event bus handler in case
 * of the Vert.x module usage.</li>
 * <li><code>debugAddress</code> {string} Event bus address to which debug
 * messages will be published in case <code>debug</code> is true and the module
 * is run as a Vert.x module. Debug messages are simple strings, not JSON
 * structures.</li>
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
var EventEmitter = require("jslibs/a-mailer/thirdPartyDeps/eventemitter2/eventemitter2").EventEmitter2;
var utillib = require("jslibs/a-mailer/thirdPartyDeps/nodejs/util/util");
var getSmtpClient = require('jslibs/a-mailer/lib/client');

//Required java classes/packages
var MimeMessage = Packages.javax.mail.internet.MimeMessage;
var MimeMultipart = Packages.javax.mail.internet.MimeMultipart;
var MimeBodyPart = Packages.javax.mail.internet.MimeBodyPart;
var ByteArrayDataSource = Packages.javax.mail.util.ByteArrayDataSource;
var DataHandler = Packages.javax.activation.DataHandler;
var MailSession = Packages.javax.mail.Session;
var System = Packages.java.lang.System;
var InternetAddress = Packages.javax.mail.internet.InternetAddress;
var RecipientType = Packages.javax.mail.Message.RecipientType;
var ByteArrayOutputStream = Packages.java.io.ByteArrayOutputStream;
var JavaDate = Packages.java.util.Date;
var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

// Module scope variables
var moduleScopeMailer;  // Reusable mailer on module scope for "sendSeq" method
                        // to keep the connection open between send requests

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
 * description, except for the <code>address</code> and
 * <code>debugAddress</code> properties.
 * @returns {Mailer} A new mailer object.
 */
exports.getMailer = function (configData) {
        return new Mailer(configData);
}; // END: getMailer()

/**
 * Mailer object
 * 
 * @param {object} configData Configuration data as mentioned in the module
 * description, except for the <code>address</code> and
 * <code>debugAddress</code> properties.
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
    this.sendTimeout = configData.sendTimeout;
    this.debug = configData.debug || false;
    this.debugAddress = configData.debugAddress;
} // END: Mailer()
utillib.inherits(Mailer, EventEmitter);

/*
 * Parse one or more email addresses.<br>
 * <br>
 * @param {string|array} single email addresses or an array of email addresses
 * @returns {array} Array of Java email addresses
 * (javax.mail.internet.InternetAddress)
 * @throws If address checking fails
 */
function parseAddresses (addrs) {
    var i, l;   // Loop vars
    var iAddrs; // Array of Java internet addresses
    var retVal; // Return value

    if (typeof addrs === 'string') {
        // In case of a string, we expect a single address
        retVal = [InternetAddress.parse(addrs)[0]];
    } else {
        // Must be an array with potentially more than one address string,
        // each representing a single address
        iAddrs = [];
        for (i = 0, l = addrs.length; i < l; i++) {
            iAddrs.push(InternetAddress.parse(addrs[i])[0]);
        }
        retVal = iAddrs;
    }
    
    return retVal;
} // END: parseAddresses()

/*
 * Send envelope for given smtp client.<br>
 * <br>
 * @param {SmtpClient} client The smtp client
 * @param {object} addrInfo Address info: fromAddr, toAddrs, ccAddrs, bccAddrs
 */
function sendEnvelope (client, addrInfo) {
    var i, l;               // Loop vars
    var envelopeToAddrs;    // Array of "to" addresses for the envelope

    envelopeToAddrs = [];
    for (i = 0, l = addrInfo.toAddrs.length; i < l; i++) {
        envelopeToAddrs.push(addrInfo.toAddrs[i].getAddress());
    }
    for (i = 0, l = addrInfo.ccAddrs.length; i < l; i++) {
        envelopeToAddrs.push(addrInfo.ccAddrs[i].getAddress());
    }
    for (i = 0, l = addrInfo.bccAddrs.length; i < l; i++) {
        envelopeToAddrs.push(addrInfo.bccAddrs[i].getAddress());
    }

    client.useEnvelope({
        from: addrInfo.fromAddr.getAddress(),
        to: envelopeToAddrs
    });
} // END: sendEnvelope

/*
 * Compose an email message.<br>
 * <br>
 * Reusable function for "send" and "sendSeq"
 * 
 * @param {object} addrInfo Address info: fromAddr, toAddrs, ccAddrs, bccAddrs
 * @param {object} sendData Send data object with subject, body text and
 * attachments
 * @param {string} textContentSubtype "plain" or "html" for MIME types
 * "text/plain" or "text/html" respectively
 * @returns {Buffer} The message in a Vert.x buffer
 */
function composeMsg(addrInfo, sendData, textContentSubtype) {
    var message;        // Message to compose
    var mimeMultipart;  // The multipart body of the message
    var textBodyPart;   // Text part of the message
    var msgBao;         // ByteArrayOutputStream for the messge
    var attachment;     // Pointer to current attachment
    var attachmentBuf;  // Current attachment as a vertx buffer
    var dataSource;     // Attachment as a ByteArrayDataSource
    var bodyPart;       // Attachment in a MimeBodyPart
    var i;              // Loop var

    // Create the mime multi part
    mimeMultipart = new MimeMultipart();

    // Create the text body part and add it to the multi part
    textBodyPart = new MimeBodyPart();
    textBodyPart.setText(sendData.body || '', 'utf-8', textContentSubtype);
    mimeMultipart.addBodyPart(textBodyPart);

    // Create the attachment body parts and add them to the multi part
    if (sendData.attachments && sendData.attachments.length > 0) {
        for (i = 0; i < sendData.attachments.length; i++) {
            attachment = sendData.attachments[i];
            if (attachment.data) {
                if (attachment.data instanceof vertx.Buffer) {
                    attachmentBuf = attachment.data;
                } else {
                    // If the attachment data is not a Vert.x buffer we assume
                    // that it is a string or it can be converted to a string
                    attachmentBuf =
                        new vertx.Buffer(DatatypeConverter.parseBase64Binary(
                            attachment.data.toString()));
                }
                dataSource =
                    new ByteArrayDataSource(attachmentBuf.getBytes(),
                        attachment.mimeType || 'text/plain');
                bodyPart = new MimeBodyPart();
                bodyPart.setDataHandler(new DataHandler(dataSource));
                bodyPart.setFileName(attachment.fileName || 'attachment' + i);
                mimeMultipart.addBodyPart(bodyPart);
            }
        }
    }
    
    // Create the MIME message
    message = new MimeMessage(MailSession.getInstance(System.getProperties()));
    message.setFrom(addrInfo.fromAddr);
    message.setRecipients(RecipientType.TO, addrInfo.toAddrs);
    if (addrInfo.ccAddrs && addrInfo.ccAddrs.length > 0) {
        message.setRecipients(RecipientType.CC, addrInfo.ccAddrs);
    }
    if (addrInfo.bccAddrs && addrInfo.bccAddrs.length > 0) {
        message.setRecipients(RecipientType.BCC, addrInfo.bccAddrs);
    }
    message.setSubject(sendData.subject, 'utf-8');
    message.setSentDate(new JavaDate());
    message.setContent(mimeMultipart);
    
    // Write the message to an in-memory structure
    msgBao = new ByteArrayOutputStream();
    message.writeTo(msgBao);
    
    return new vertx.Buffer(msgBao.toByteArray());
} // END: composeMsg()

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
 * @param {string} [sendData.content_type] MIME type for the "main" body of the
 * email; either <code>text/plain</code> or <code>text/html</code>. If otherwise
 * specified or not specified at all the configured MIME type for the module
 * will be used as the default value. Character set encoding specification as
 * in <code>text/plain; charset=Cp1252</code> is NOT allowed here, UTF-8 is
 * always assumed for the main body.
 * @param {array} [sendData.attachments] Multiple attachments in an array; each
 * array entry is an object with three properties:
 * <ul>
 * <li><code>data</code>: The binary attachment data, either in a Vert.x Buffer
 * or as a base64 encoded string.</li>
 * <li><code>mimeType</code>: MIME type of the attachment data; should include
 * a character set encoding specification for text MIME types, e.g.
 * <code>text/plain; charset=utf-8</code></li>
 * <li><code>fileName</code>: File name for the attachment inside of the
 * email</li>
 * </ul> 
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
    var addressInfo;        // Address info for the message
    var sendError;			// Error in the course of the send method
    var sendResult;			// Result of send operation
    var sendContentSubtype;	// MIME subtype for this send request
    var sendTimeoutTimer;   // Timer for send timeouts
    var self = this;

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
            ignoreTLS: true,
            debug: this.debug
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
    if (this.debug) {
        this.emit("debug", 'Smtp client created');
    }

    if (this.sendTimeout) {
        sendTimeoutTimer = vertx.setTimer(this.sendTimeout, function() {
            sendTimeoutTimer = undefined;
            // "close" triggers the emittance of the "end" event and destroys
            // the client
            sendError = new Error('A-Mailer: Send timeout');
            smtpClient.close();
        });
    }

    // ========================================================================
    // Set event handlers
    //
    // NOTE: The sequence of setting the handlers below does not affect the
    // program logic, BUT changing the order will make the unit tests fail,
    // because those tests rely on a certain order. This is kind of stupid,
    // but I did not find a different way to ensure that the event handlers
    // get called with the right arguments.
    // ========================================================================
    
    // =======================
    // Set exception handlers
    // =======================

    // Sets the "send error", which has a "toString" method
    // and optionally the properties "name", "data", "code".
    smtpClient.on('error', function(err){
        sendError = err;
        // "close" triggers the emittance of the "end" event and destroys
        // the client
        smtpClient.close();
    });

    smtpClient.on('rcptFailed', function(failedAddresses){
        sendResult.rcptFailedAdrs = failedAddresses;
    });

    // Optionally set a debug handler
    if (this.debug) {
        smtpClient.on('debug', function (msg) {
            self.emit("debug", msg);
        });
    }

    // ==========================
    // Set control flow handlers
    // ==========================
    addressInfo = {
            'fromAddr': fromAddr,
            'toAddrs': toAddrs,
            'ccAddrs': ccAddrs,
            'bccAddrs': bccAddrs
    };
    
    smtpClient.once('idle', function () {
        sendEnvelope(smtpClient, addressInfo);
    });

    smtpClient.on('message', function () {
        try {
            // Send the message
            smtpClient.end(composeMsg(addressInfo, sendData,
                    sendContentSubtype));
        } catch (msgError) {
            sendError = msgError;
            // "close" triggers the emittance of the "end" event and destroys
            // the client
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
        if (sendTimeoutTimer) {
            vertx.cancelTimer(sendTimeoutTimer);
        }
        callback(sendError, sendResult);
    });
}; // END: send()

/**
 * Send email messages sequentially over a single TCP connection.<br>
 * <br>
 * This method opens a new connection to the server, if no connection is
 * established. Subsequent calls to this method reuse the same connection.
 * After all calls have been made, the <code>sendSeqEnd</code> method must be
 * called to close the connection.<br>
 * <br>
 * <b>NOTE 1</b><br>
 * The user of this method is responsible for ensuring, that subsequent calls
 * only happen, after the previous call has finished successfully.<br>
 * <br>
 * <b>NOTE 2</b><br>
 * When the callback receives an error, you can assume that the connection is
 * destroyed and any subsequent call will try to create a new connection.<br>
 * <br>
 * The parameters and the return value are the same as for the
 * <code>send</code> method.
 */
Mailer.prototype.sendSeq = function (sendData, callback) {
    var smtpClient;         // Underlying SMTP client
    var mailOpts;           // Mail client options
    var fromAddr;           // "from" address as a Java object
    var toAddrs;            // Array of "to" addresses as Java objects
    var ccAddrs;            // Array of "cc" addresses as Java objects
    var bccAddrs;           // Array of "bcc" addresses as Java objects
    var addressInfo;        // Address info for the message
    var sendError;          // Error in the course of the send method
    var sendResult;         // Result of send operation
    var sendContentSubtype; // MIME subtype for this send request
    var sendTimeoutTimer;   // Timer for send timeouts
    var self = this;

    /*
     * Reusable function to return and error
     */
    function returnError (err) {
        if (sendTimeoutTimer) {
            vertx.cancelTimer(sendTimeoutTimer);
        }
        if (smtpClient) {
            try {
                smtpClient.close();
            } catch (ignore) {}
            smtpClient = undefined;
        }
        callback(err);
    } // END: returnError
    
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
        returnError(new Error('a-mailer.send: Missing send data'));
        return;
    }
    if (!sendData.from) {
        returnError(new Error('a-mailer.send: Missing "from" field'));
        return;
    }
    if (!sendData.to) {
        returnError(new Error('a-mailer.send: Missing "to" field'));
        return;
    }
    if (!sendData.subject) {
        returnError(new Error('a-mailer.send: Missing "subject" field'));
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
    try {
        fromAddr = InternetAddress.parse(sendData.from)[0];
    } catch (parseErr) {
        returnError(new Error('a-mailer.send: Illegal "from" address: ' +
                parseErr.toString()));
        return;
    }
    try {
        toAddrs = parseAddresses(sendData.to);
        if (toAddrs.length === 0) {
            throw new Error('Missing "to" address');
        }
    } catch (parseErr) {
        returnError(new Error('a-mailer.send: Illegal "to" address: ' +
                parseErr.toString()));
        return;     
    }
    try {
        ccAddrs = parseAddresses(sendData.cc || []);
    } catch (parseErr) {
        returnError(new Error('a-mailer.send: Illegal "cc" address: ' +
                parseErr.toString()));
        return;     
    }
    try {
        bccAddrs = parseAddresses(sendData.bcc || []);
    } catch (parseErr) {
        returnError(new Error('a-mailer.send: Illegal "bcc" address: ' +
                parseErr.toString()));
        return;     
    }
    
    // ===================
    // Set up mail client
    // ===================
    if (this._smtpClient) {
        // We already have a client
        if (!this._isIdle) {
            // If not idle, "sendSeq" was called before its callback
            // returned with success => error
            returnError(new Error('a-mailer.send: SMTP client not idle'));
            return;
        }
        
        this._isIdle = false;
        smtpClient = this._smtpClient;
        smtpClient.removeAllListeners();
        
        // By emitting the "idle" event with the "next tick" we make sure that
        // the event handlers below are attached first
        vertx.runOnContext(function () {
            smtpClient.emit('idle');
        });
    }  else {
        // No current client in this._smtpClient => create a new one
        mailOpts = {
                ignoreTLS: true,
                debug: this.debug
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
        if (this.debug) {
            this.emit("debug", 'Smtp client created');
        }
        
        this._smtpClient = smtpClient;
        // Set the "_isIdle" flag initially to false, so that subsequent calls
        // to "sendSeq" return an error until the flag is set to true after
        // sending a message
        this._isIdle = false;
    }
    
    if (this.sendTimeout) {
        sendTimeoutTimer = vertx.setTimer(this.sendTimeout, function() {
            sendTimeoutTimer = undefined;
            returnError(new Error('A-Mailer: Send timeout'));
        });
    }
    
    // ========================================================================
    // Set event handlers
    //
    // NOTE: The sequence of setting the handlers below does not affect the
    // program logic, BUT changing the order will make the unit tests fail,
    // because those tests rely on a certain order. This is kind of stupid,
    // but I did not find a different way to ensure that the event handlers
    // get called with the right arguments.
    // ========================================================================

    // =======================
    // Set exception handlers
    // =======================

    // Sets the "send error", which has a "toString" method
    // and optionally the properties "name", "data", "code".
    smtpClient.on('error', function(err){
        sendError = err;
        // "close" triggers the emittance of the "end" event and destroys
        // the client
        returnError(sendError);
    });

    smtpClient.on('rcptFailed', function(failedAddresses){
        sendResult.rcptFailedAdrs = failedAddresses;
    });
    
    // Optionally set a debug handler
    if (this.debug) {
        smtpClient.on('debug', function (msg) {
            self.emit("debug", msg);
        });
    }
    
    // ==========================
    // Set control flow handlers
    // ==========================
    addressInfo = {
            'fromAddr': fromAddr,
            'toAddrs': toAddrs,
            'ccAddrs': ccAddrs,
            'bccAddrs': bccAddrs
    };
    
    smtpClient.once('idle', function () {
        sendEnvelope(smtpClient, addressInfo);
    });

    smtpClient.on('message', function () {
        try {
            // Send the message
            smtpClient.end(composeMsg(addressInfo, sendData,
                    sendContentSubtype));
        } catch (msgError) {
            sendError = msgError;
            // "close" triggers the emittance of the "end" event and destroys
            // the client
            returnError(sendError);
        }
    });

    smtpClient.on('ready', function (success, response) {
        if (!success) {
            sendError = new Error(response);
            // "close" triggers the emittance of the "end" event and destroys
            // the client
            returnError(sendError);
            return;
        }

        // Successful server response
        sendResult.response = response;
        // NOTE: This handler relies on implicit implementation knowledge of
        // the smtp client from client.js, namely: The "ready" event is
        // always followed by an "idle" event, which is emitted, AFTER this
        // "ready" handler has finished (by using "vertx.runOnContext(...)"
        smtpClient.once('idle', function () {
            if (sendTimeoutTimer) {
                vertx.cancelTimer(sendTimeoutTimer);
            }
            self._isIdle = true;
            callback(undefined, sendResult);
        });
    });

    // NOTE
    // We do not implement an "end" handler in this case because the callback
    // is either triggerd by the "ready" handler in case of success or directly
    // in case of an error
    
}; // END: sendSeq()

/**
 * End a sequence of messages over the same connnection.<br>
 * <br>
 * Send the QUIT command to the server and closes the connection. Note that
 * there is no callback parameter. We do not care about server response in this
 * case.
 */
Mailer.prototype.sendSeqEnd = function () {
    if (this._smtpClient) {
        try {
            this._smtpClient.quit();
        } catch (ignore) {}
    }
    this._smtpClient = undefined;
}; // END: sendSeqEnd()

//======================
// Event Bus Connection
//======================

//If we have an address, connect to the event  bus and make the "send" method
//available with roughly the same API
if (container.config.address) {
    vertx.eventBus.registerHandler(container.config.address,
    function (data, replier) {
        var mailer;     // mailer object to send the email with

        if (data.method === 'sendSeq') {
            // ================
            // Method: sendSeq
            // ================
            if (!moduleScopeMailer) {
                moduleScopeMailer = exports.getMailer(container.config);
                if (moduleScopeMailer.debug && moduleScopeMailer.debugAddress) {
                    moduleScopeMailer.on('debug', function (msg) {
                        vertx.eventBus.publish(moduleScopeMailer.debugAddress,
                                msg);
                    });
                }
            }
            moduleScopeMailer.sendSeq(data, function (err, result) {
                if (err) {
                    replier({
                        errorMsg: err.toString()
                    });
                    moduleScopeMailer.removeAllListeners();
                    moduleScopeMailer = undefined;
                } else {
                    replier(result);
                }
            });
        } else if (data.method === 'sendSeqEnd') {
            // ===================
            // Method: sendSeqEnd
            // ===================
            if (moduleScopeMailer) {
                moduleScopeMailer.sendSeqEnd();
                moduleScopeMailer.removeAllListeners();
                moduleScopeMailer = undefined;
            }
            replier({
                response: 'OK'
            });            
        } else if (!data.method || data.method === 'send') {
            // =============
            // Method: send
            // =============
            mailer = exports.getMailer(container.config);
            if (mailer.debug && mailer.debugAddress) {
                mailer.on('debug', function (msg) {
                    vertx.eventBus.publish(mailer.debugAddress, msg);
                });
            }
            mailer.send(data, function (err, result) {
                if (err) {
                    replier({
                        errorMsg: err.toString()
                    });
                } else {
                    replier(result);
                }
                mailer.removeAllListeners();
            });
        } else {
            replier({
                errorMsg: 'No such method: ' + data.method
            });            
        }
    });
}
