"use strict";

var EventEmitter = require("jslibs/a-mailer/thirdPartyDeps/eventemitter2/eventemitter2").EventEmitter2,
    utillib = require("jslibs/a-mailer/thirdPartyDeps/nodejs/util/util"),
    vertx = require("vertx");
    // xoauth2 = require("xoauth2")

var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

// "Simulate" setTimeout, clearTimeout
function setTimeout (f, t) { vertx.setTimer(t, f); };
function clearTimeout(id) { if (id) { vertx.cancelTimer(id); }};

/**
 * @module jslibs/a-mailer/lib/client
 */

/**
 * <p>Generates a SMTP connection object</p>
 *
 * <p>Optional options object takes the following possible properties:</p>
 * <ul>
 *     <li><b>secureConnection</b> - use SSL</li>
 *     <li><b>name</b> - the name of the client server</li>
 *     <li><b>auth</b> - authentication object <code>{user:"...", pass:"..."}</code>
 *     <li><b>ignoreTLS</b> - ignore server support for STARTTLS</li>
 *     <li><b>tls</b> - options for createCredentials</li>
 *     <li><b>debug</b> - emit debug events</li>
 *     <li><b>instanceId</b> - unique instance id for debugging</li>
 *     <li><b>greetingTimeout</b> - Time in ms to wait for server greeting</li>
 * </ul>
 * 
 * @param {Number} [port=25] Port number to connect to
 * @param {String} [host="localhost"] Hostname to connect to
 * @param {Object} [options] Option properties
 * @returns {client~SMTPClient} A new SMTP connection
 */
module.exports = function(port, host, options){
    var connection = new SMTPClient(port, host, options);
    vertx.runOnContext(function () { connection.connect(); });
    return connection;
};

/**
 * Connection constructor
 * 
 * @constructor
 */
function SMTPClient(port, host, options){
    EventEmitter.call(this);

    this.options = options || {};

    this.port = port || (this.options.secureConnection ? 465 : 25);
    this.host = host || "localhost";

    this.options.secureConnection = !!this.options.secureConnection;
    this.options.auth = this.options.auth || false;
    this.options.maxConnections = this.options.maxConnections || 5;

    if(!this.options.name){
        // default hostname is machine hostname or [IP]
        var defaultHostname = '';
        try {
        	defaultHostname = Packages.java.net.InetAddress.getLocalHost().getCanonicalHostName();
        } catch (ignore) {}
        
        if(defaultHostname.indexOf('.')<0){
            defaultHostname = "[127.0.0.1]";
        }
        if(defaultHostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)){
            defaultHostname = "["+defaultHostname+"]";
        }

        this.options.name = defaultHostname;
    }

    this._init();
}
utillib.inherits(SMTPClient, EventEmitter);

/**
 * <p>Initializes instance variables</p>
 * @private
 */
SMTPClient.prototype._init = function(){
    /**
     * Defines if the current connection is secure or not. If not,
     * STARTTLS can be used if available
     * @private
     */
    this._secureMode = false;

    /**
     * Ignore incoming data on TLS negotiation
     * @private
     */
    this._ignoreData = false;

    /**
     * Store incomplete messages coming from the server
     * @private
     */
    this._remainder = "";

    /**
     * If set to true, then this object is no longer active
     * @private
     */
    this.destroyed = false;

    /**
     * The socket connecting to the server
     * @private
     */
    this.socket = false;

    /**
     * Lists supported auth mechanisms
     * @private
     */
    this._supportedAuth = [];

    /**
     * Currently in data transfer state
     * @private
     */
    this._dataMode = false;

    /**
     * Keep track if the client sends a leading \r\n in data mode
     * @private
     */
    this._lastDataBytes = new vertx.Buffer(2);

    /**
     * Function to run if a data chunk comes from the server
     * @private
     */
    this._currentAction = false;

    /**
     * Timeout variable for waiting the greeting
     * @private
     */
    this._greetingTimeout = false;

    /**
     * Timeout variable for waiting the connection to start
     * @private
     */
    this._connectionTimeout = false;

    if(this.options.ignoreTLS || this.options.secureConnection){
        this._secureMode = true;
    }

    /**
     * XOAuth2 token generator if XOAUTH2 auth is used
     * @private
     */
    this._xoauth2 = false;

    if(typeof this.options.auth.XOAuth2 == "object" && typeof this.options.auth.XOAuth2.getToken == "function"){
        this._xoauth2 = this.options.auth.XOAuth2;
    }else if(typeof this.options.auth.XOAuth2 == "object"){
        if(!this.options.auth.XOAuth2.user && this.options.auth.user){
            this.options.auth.XOAuth2.user = this.options.auth.user;
        }
        this._xoauth2 = xoauth2.createXOAuth2Generator(this.options.auth.XOAuth2);
    }
};

/**
 * <p>Creates a connection to a SMTP server and sets up connection
 * listener</p>
 */
SMTPClient.prototype.connect = function(){
    var opts = {};
    var net = tls = vertx.createNetClient();
    var self = this;
    if(this.options.secureConnection){
    	tls.ssl(true).trustAll(true);
        tls.connect(this.port, this.host, function (err, sock) {
        	if (!err) {
        		self.socket = sock;
        		self.socket.exceptionHandler(function () { self._onError(new Error('Socket exception')); });
        		self._onConnect();
        	} else {
        		self._onError(err);
        	}
        });
    }else{
        opts = {
            port: this.port,
            host: this.host
        };
        net.connect(this.port, this.host, function (err, sock) {
        	if (!err) {
        		self.socket = sock;
        		self.socket.exceptionHandler(function () { self._onError(new Error('Socket exception')); });
        		self._onConnect();
        	} else {
        		self._onError(err);
        	}
        });
    }

    if(this.options.connectionTimeout){
        this._connectionTimeout = setTimeout((function(){
            var error = new Error("Connection timeout");
            error.code = "ETIMEDOUT";
            error.errno = "ETIMEDOUT";
            self.emit("error", error);
            self.close();
        }), this.options.connectionTimeout);
    }
};

/**
 * <p>Upgrades the connection to TLS</p>
 *
 * @param {Function} callback Callbac function to run when the connection
 *        has been secured
 *        
 * @private
 */
SMTPClient.prototype._upgradeConnection = function(callback){
	var self = this;
    this._ignoreData = true;
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");

    var opts = {
        socket: this.socket,
        host: this.host,
        rejectUnauthorized: !!this.options.rejectUnauthorized
    };

    Object.keys(this.options.tls || {}).forEach((function(key){
        opts[key] = self.options.tls[key];
    }));

    this.socket = tls.connect(opts, (function(){
        self._ignoreData = false;
        self._secureMode = true;
        self.socket.dataHandler(function (data) { self._onData(data); });
        self.socket.exceptionHandler(function () { self._onError(new Error('TLS Socket exception')); });
        
        return callback(null, true);
    }));
};

/**
 * <p>Connection listener that is run when the connection to
 * the server is opened</p>
 *
 * @private
 */
SMTPClient.prototype._onConnect = function(){
	var self = this;
    clearTimeout(this._connectionTimeout);

    // Turn SMTPClient into a WriteStream by attaching the relevant
    // socket methods
    this.drainHandler = this.socket.drainHandler;
    this.exceptionHandler = this.socket.exceptionHandler;
    this.write = this.socket.write;
    this.writeQueueFull = this.socket.writeQueueFull;
    this.writeQueueMaxSize = this.socket.writeQueueMaxSize;
    
    if("setKeepAlive" in this.socket){
        this.socket.tcpKeepAlive(true);
    }

    if("setNoDelay" in this.socket){
        this.socket.tcpNoDelay(true);
    }

    this.socket.dataHandler(function (data) { self._onData(data); });
    this.socket.closeHandler(function () { self._onClose(); });
    this.socket.endHandler(function () { self._onEnd(); });

    this._greetingTimeout = setTimeout(function(){
        // if strill waiting for greeting, give up
        if(self._currentAction == self._actionGreeting){
            var error = new Error("Greeting never received");
            error.code = "ETIMEDOUT";
            error.errno = "ETIMEDOUT";
            self.emit("error", error);
            self.close();
        }
    }, this.options.greetingTimeout || 10000);

    this._currentAction = this._actionGreeting;
};

/**
 * <p>Destroys the client - removes listeners etc.</p>
 * 
 * @private
 */
SMTPClient.prototype._destroy = function(){
    if(this._destroyed)return;
    this._destroyed = true;
    this._ignoreData = true;
    this.emit("end");
    this.removeAllListeners();
};

/**
 * <p>'data' listener for data coming from the server</p>
 *
 * @param {vertxBuffer} chunk Data chunk coming from the server
 * 
 * @private
 */
SMTPClient.prototype._onData = function(chunk){
    var str;

    if(this._ignoreData || !chunk || !chunk.length()){
        return;
    }

    // Wait until end of line
    if(chunk.getByte(chunk.length()-1) != 0x0A){
        this._remainder += chunk.toString();
        return;
    }else{
        str = (this._remainder + chunk.toString()).trim();
        this._remainder = "";
    }

    // if this is a multi line reply, wait until the ending
    if(str.match(/(?:^|\n)\d{3}-.+$/)){
        this._remainder = str + "\r\n";
        return;
    }

    if(this.options.debug){
    	this.emit("debug", "SERVER"+(this.options.instanceId?" "+
            this.options.instanceId:"")+":\n>> "+str.replace(/\r?\n/g,"\n   "));
    }

    if(typeof this._currentAction == "function"){
        this._currentAction.call(this, str);
    }
};

/**
 * <p>'error' listener for the socket</p>
 *
 * @param {Error} err Error object
 * @param {String} type Error name
 * 
 * @private 
 */
SMTPClient.prototype._onError = function(err, type, data){
    if(type && type != "Error"){
        err.name = type;
    }
    if(data){
        err.data = data;
    }
    this.emit("error", err);
    this.close();
};

/**
 * <p>'close' listener for the socket</p>
 *
 * @private
 */
SMTPClient.prototype._onClose = function(){
    this._destroy();
};

/**
 * <p>'end' listener for the socket</p>
 *
 * @private
 */
SMTPClient.prototype._onEnd = function(){
    this._destroy();
};

/**
 * <p>'timeout' listener for the socket</p>
 *
 * @private
 */
SMTPClient.prototype._onTimeout = function(){
    this.close();
};

/**
 * <p>Passes data stream to socket if in data mode</p>
 *
 * @param {vertxBuffer|String} chunk Chunk of data to be sent to the server
 */
SMTPClient.prototype.write = function(chunk){
    // works only in data mode
    if(!this._dataMode || this._destroyed){
        // this line should never be reached but if it does, then
        // say act like everything's normal.
        return true;
    }

    if(typeof chunk == "string"){
        chunk = new vertx.Buffer(chunk, "utf-8");
    }

    if(chunk.length() > 2){
        this._lastDataBytes.setByte(0, chunk.getByte(chunk.length()-2));
        this._lastDataBytes.setByte(1, chunk.getByte(chunk.length()-1));
    }else if(chunk.length() == 1){
    	this._lastDataBytes.setByte(0, this._lastDataBytes.getByte(1));
    	this._lastDataBytes.setByte(1, chunk.getByte(0));
    }

    if(this.options.debug){
    	this.emit("debug", "CLIENT (DATA)"+(this.options.instanceId?" "+
            this.options.instanceId:"")+":\n>> "+chunk.toString().trim().replace(/\n/g,"\n   "));
    }

    // pass the chunk to the socket
    return this.socket.write(chunk);
};

/**
 * <p>Indicates that a data stream for the socket is ended. Works only
 * in data mode.</p>
 *
 * @param {vertxBuffer|String} [chunk] Chunk of data to be sent to the server
 */
SMTPClient.prototype.end = function(chunk){
    // works only in data mode
    if(!this._dataMode || this._destroyed){
        // this line should never be reached but if it does, then
        // say act like everything's normal.
        return true;
    }

    if(chunk &&
    		(
    				(typeof chunk.length === 'function' && chunk.length()) ||	// for vertx Buffers
    				(typeof chunk.length === 'number' && chunk.length)			// for strings
    		)){
    	this.write(chunk);
    }

    // redirect output from the server to _actionStream
    this._currentAction = this._actionStream;

    // indicate that the stream has ended by sending a single dot on its own line
    // if the client already closed the data with \r\n no need to do it again
    if(this._lastDataBytes.getByte(0) == 0x0D && this._lastDataBytes.getByte(1) == 0x0A){
        this.socket.write(new vertx.Buffer(".\r\n", "utf-8"));
    }else if(this._lastDataBytes.getByte(1) == 0x0D){
        this.socket.write(new vertx.Buffer("\n.\r\n"));
    }else{
        this.socket.write(new vertx.Buffer("\r\n.\r\n"));
    }

    // end data mode
    this._dataMode = false;
};

/**
 * <p>Send a command to the server, append \r\n</p>
 *
 * @param {String} str String to be sent to the server
 */
SMTPClient.prototype.sendCommand = function(str){
    if(this._destroyed){
        // Connection already closed, can't send any more data
        return;
    }
    if(this.options.debug){
    	this.emit("debug", "CLIENT"+(this.options.instanceId?" "+
            this.options.instanceId:"")+":\n>> "+(str || "").toString().trim().replace(/\n/g,"\n   "));
    }
    this.socket.write(new vertx.Buffer(str+"\r\n", "utf-8"));
};

/**
 * <p>Sends QUIT</p>
 */
SMTPClient.prototype.quit = function(){
    this.sendCommand("QUIT");
    this._currentAction = this.close;
};

/**
 * <p>Closes the connection to the server</p>
 */
SMTPClient.prototype.close = function(){
	try {
	    if(this.options.debug){
	    	this.emit("debug", "Closing connection to the server");
	    }
	    if(this.socket && this.socket.close){
	        this.socket.close();
	    }
	} catch (ignore) {}
    this._destroy();
};

/**
 * <p>Initiates a new message by submitting envelope data, starting with
 * <code>MAIL FROM:</code> command</p>
 *
 * @param {Object} envelope Envelope object in the form of
 *        <code>{from:"...", to:["..."]}</code>
 */
SMTPClient.prototype.useEnvelope = function(envelope){
    this._envelope = envelope || {};
    this._envelope.from = this._envelope.from || ("anonymous@"+this.options.name);

    // clone the recipients array for later manipulation
    this._envelope.rcptQueue = JSON.parse(JSON.stringify(this._envelope.to || []));
    this._envelope.rcptFailed = [];

    this._currentAction = this._actionMAIL;
    this.sendCommand("MAIL FROM:<"+(this._envelope.from)+">");
};

/**
 * <p>If needed starts the authentication, if not emits 'idle' to
 * indicate that this client is ready to take in an outgoing mail</p>
 * 
 * @private
 */
SMTPClient.prototype._authenticateUser = function(){
	var self = this;
	
    if(!this.options.auth){
        // no need to authenticate, at least no data given
        this._currentAction = this._actionIdle;
        this.emit("idle"); // ready to take orders
        return;
    }

    var auth;
    if(this.options.auth.XOAuthToken && this._supportedAuth.indexOf("XOAUTH")>=0){
        auth = "XOAUTH";
    }else if(this._xoauth2 && this._supportedAuth.indexOf("XOAUTH2")>=0){
        auth = "XOAUTH2";
    }else if(this.options.authMethod) {
        auth = this.options.authMethod.toUpperCase().trim();
    }else{
        // use first supported
        auth = (this._supportedAuth[0] || "PLAIN").toUpperCase().trim();
    }

    switch(auth){
        case "XOAUTH":
            this._currentAction = this._actionAUTHComplete;

            if(typeof this.options.auth.XOAuthToken == "object" &&
              typeof this.options.auth.XOAuthToken.generate == "function"){
                this.options.auth.XOAuthToken.generate((function(err, XOAuthToken){
                    if(err){
                        return self._onError(err, "XOAuthTokenError");
                    }
                    self.sendCommand("AUTH XOAUTH " + XOAuthToken);
                }));
            }else{
                this.sendCommand("AUTH XOAUTH " + this.options.auth.XOAuthToken.toString());
            }
            return;
        case "XOAUTH2":
            this._currentAction = this._actionAUTHComplete;
            this._xoauth2.getToken((function(err, token){
                if(err){
                    self._onError(err, "XOAUTH2Error");
                    return;
                }
                self.sendCommand("AUTH XOAUTH2 " + token);
            }));
            return;
        case "LOGIN":
            this._currentAction = this._actionAUTH_LOGIN_USER;
            this.sendCommand("AUTH LOGIN");
            return;
        case "PLAIN":
            this._currentAction = this._actionAUTHComplete;
            this.sendCommand("AUTH PLAIN " + DatatypeConverter.printBase64Binary((new vertx.Buffer(
                    //this.options.auth.user+"\u0000"+
                    "\u0000"+ // skip authorization identity as it causes problems with some servers
                    this.options.auth.user+"\u0000"+
                    this.options.auth.pass,"utf-8")).getBytes()));
            return;
    }

    this._onError(new Error("Unknown authentication method - "+auth), "UnknowAuthError");
};

/** ACTIONS **/

/**
 * <p>Will be run after the connection is created and the server sends
 * a greeting. If the incoming message starts with 220 initiate
 * SMTP session by sending EHLO command</p>
 *
 * @param {String} str Message from the server
 * 
 * @private 
 */
SMTPClient.prototype._actionGreeting = function(str){
    clearTimeout(this._greetingTimeout);

    if(str.substr(0,3) != "220"){
        this._onError(new Error("Invalid greeting from server - "+str), false, str);
        return;
    }

    this._currentAction = this._actionEHLO;
    this.sendCommand("EHLO "+this.options.name);
};

/**
 * <p>Handles server response for EHLO command. If it yielded in
 * error, try HELO instead, otherwise initiate TLS negotiation
 * if STARTTLS is supported by the server or move into the
 * authentication phase.</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionEHLO = function(str){
    if(str.charAt(0) != "2"){
        // Try HELO instead
        this._currentAction = this._actionHELO;
        this.sendCommand("HELO "+this.options.name);
        return;
    }

    // Detect if the server supports STARTTLS
    if(!this._secureMode && str.match(/[ \-]STARTTLS\r?$/mi)){
        this.sendCommand("STARTTLS");
        this._currentAction = this._actionSTARTTLS;
        return;
    }

    // Detect if the server supports PLAIN auth
    if(str.match(/AUTH(?:\s+[^\n]*\s+|\s+)PLAIN/i)){
        this._supportedAuth.push("PLAIN");
    }

    // Detect if the server supports LOGIN auth
    if(str.match(/AUTH(?:\s+[^\n]*\s+|\s+)LOGIN/i)){
        this._supportedAuth.push("LOGIN");
    }

    // Detect if the server supports XOAUTH auth
    if(str.match(/AUTH(?:\s+[^\n]*\s+|\s+)XOAUTH/i)){
        this._supportedAuth.push("XOAUTH");
    }

    // Detect if the server supports XOAUTH2 auth
    if(str.match(/AUTH(?:\s+[^\n]*\s+|\s+)XOAUTH2/i)){
        this._supportedAuth.push("XOAUTH2");
    }

    this._authenticateUser.call(this);
};

/**
 * <p>Handles server response for HELO command. If it yielded in
 * error, emit 'error', otherwise move into the authentication phase.</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionHELO = function(str){
    if(str.charAt(0) != "2"){
        this._onError(new Error("Invalid response for EHLO/HELO - "+str), false, str);
        return;
    }
    this._authenticateUser.call(this);
};

/**
 * <p>Handles server response for STARTTLS command. If there's an error
 * try HELO instead, otherwise initiate TLS upgrade. If the upgrade
 * succeedes restart the EHLO</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionSTARTTLS = function(str){
	var self = this;
	
    if(str.charAt(0) != "2"){
        // Try HELO instead
        this._currentAction = this._actionHELO;
        this.sendCommand("HELO "+this.options.name);
        return;
    }

    this._upgradeConnection((function(err, secured){
        if(err){
            self._onError(new Error("Error initiating TLS - "+(err.message || err)), "TLSError");
            return;
        }
        if(self.options.debug){
        	self.emit("debug", "Connection secured");
        }

        if(secured){
            // restart session
            self._currentAction = self._actionEHLO;
            self.sendCommand("EHLO "+self.options.name);
        }else{
            self._authenticateUser.call(self);
        }
    }));
};

/**
 * <p>Handle the response for AUTH LOGIN command. We are expecting
 * '334 VXNlcm5hbWU6' (base64 for 'Username:'). Data to be sent as
 * response needs to be base64 encoded username.</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionAUTH_LOGIN_USER = function(str){
    if(str != "334 VXNlcm5hbWU6"){
        this._onError(new Error("Invalid login sequence while waiting for '334 VXNlcm5hbWU6' - "+str), false, str);
        return;
    }
    this._currentAction = this._actionAUTH_LOGIN_PASS;
    this.sendCommand('' + DatatypeConverter.printBase64Binary((new vertx.Buffer(
    		this.options.auth.user, "utf-8")).getBytes()));
};

/**
 * <p>Handle the response for AUTH LOGIN command. We are expecting
 * '334 UGFzc3dvcmQ6' (base64 for 'Password:'). Data to be sent as
 * response needs to be base64 encoded password.</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionAUTH_LOGIN_PASS = function(str){
    if(str != "334 UGFzc3dvcmQ6"){
        this._onError(new Error("Invalid login sequence while waiting for '334 UGFzc3dvcmQ6' - "+str), false, str);
        return;
    }
    this._currentAction = this._actionAUTHComplete;
    this.sendCommand('' + DatatypeConverter.printBase64Binary((new vertx.Buffer(this.options.auth.pass, "utf-8")).getBytes()));
};

/**
 * <p>Handles the response for authentication, if there's no error,
 * the user can be considered logged in. Emit 'idle' and start
 * waiting for a message to send</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionAUTHComplete = function(str){
    var response;

    if(this._xoauth2 && str.substr(0, 3) == "334"){
        try{
            response = str.split(" ");
            response.shift();
            response = JSON.parse(new Buffer(response.join(" "), "base64").toString("utf-8"));
            
            if((!this._xoauth2.reconnectCount || this._xoauth2.reconnectCount < 200) && ['400','401'].indexOf(response.status)>=0){
                this._xoauth2.reconnectCount = (this._xoauth2.reconnectCount || 0) + 1;
                this._currentAction = this._actionXOAUTHRetry;
            }else{
                this._xoauth2.reconnectCount = 0;
                this._currentAction = this._actionAUTHComplete;
            }
            this.sendCommand(new Buffer(0));
            return;

        }catch(E){}
    }

    this._xoauth2.reconnectCount = 0;

    if(str.charAt(0) != "2"){
        this._onError(new Error("Invalid login - "+str), "AuthError", str);
        return;
    }

    this._currentAction = this._actionIdle;
    this.emit("idle"); // ready to take orders
};

/**
 * If XOAUTH2 authentication failed, try again by generating
 * new access token
 * 
 * @private 
 */
SMTPClient.prototype._actionXOAUTHRetry = function(){

    // ensure that something is listening unexpected responses
    this._currentAction = this._actionIdle;

    this._xoauth2.generateToken((function(err, token){
        if(self._destroyed){
            // Nothing to do here anymore, connection already closed
            return;
        }
        if(err){
            self._onError(err, "XOAUTH2Error");
            return;
        }
        self._currentAction = self._actionAUTHComplete;
        self.sendCommand("AUTH XOAUTH2 " + token);
    }));
};

/**
 * <p>This function is not expected to run. If it does then there's probably
 * an error (timeout etc.)</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionIdle = function(str){
    if(Number(str.charAt(0)) > 3){
        this._onError(new Error(str), false, str);
        return;
    }

    // this line should never get called
};

/**
 * <p>Handle response for a <code>MAIL FROM:</code> command</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionMAIL = function(str){
    if(Number(str.charAt(0)) != "2"){
        this._onError(new Error("Mail from command failed - " + str), "SenderError", str);
        return;
    }

    if(!this._envelope.rcptQueue.length){
        this._onError(new Error("Can't send mail - no recipients defined"), "RecipientError", str);
    }else{
        this._envelope.curRecipient = this._envelope.rcptQueue.shift();
        this._currentAction = this._actionRCPT;
        this.sendCommand("RCPT TO:<"+this._envelope.curRecipient+">");
    }
};

/**
 * <p>Handle response for a <code>RCPT TO:</code> command</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionRCPT = function(str){
    if (str.substr(0, 3) == "421") {
        this._onError(new Error("RCPT TO failed - " + str), false, str);
        return;        
    } else if (Number(str.charAt(0)) != "2") {
        // this is a soft error
        this._envelope.rcptFailed.push(this._envelope.curRecipient);
    }

    if(!this._envelope.rcptQueue.length){
        if(this._envelope.rcptFailed.length < this._envelope.to.length){
            this.emit("rcptFailed", this._envelope.rcptFailed);
            this._currentAction = this._actionDATA;
            this.sendCommand("DATA");
        }else{
            this._onError(new Error("Can't send mail - all recipients were rejected"), "RecipientError", str);
            return;
        }
    }else{
        this._envelope.curRecipient = this._envelope.rcptQueue.shift();
        this._currentAction = this._actionRCPT;
        this.sendCommand("RCPT TO:<"+this._envelope.curRecipient+">");
    }
};

/**
 * <p>Handle response for a <code>DATA</code> command</p>
 *
 * @param {String} str Message from the server
 * 
 * @private
 */
SMTPClient.prototype._actionDATA = function(str){
    // response should be 354 but according to this issue https://github.com/eleith/emailjs/issues/24
    // some servers might use 250 instead, so lets check for 2 or 3 as the first digit
    if([2,3].indexOf(Number(str.charAt(0)))<0){
        this._onError(new Error("Data command failed - " + str), false, str);
        return;
    }

    // Emit that connection is set up for streaming
    this._dataMode = true;
    this._currentAction = this._actionIdle;
    this.emit("message");
};

/**
 * <p>Handle response for a <code>DATA</code> stream</p>
 *
 * @param {String} str Message from the server
 * 
 * @private 
 */
SMTPClient.prototype._actionStream = function(str){
	var self = this;
    if(Number(str.charAt(0)) != "2"){
        // Message failed
        this.emit("ready", false, str);
    }else{
        // Message sent succesfully
        this.emit("ready", true, str);
    }

    // Waiting for new connections
    this._currentAction = this._actionIdle;
    
    // NOTE: The A-Mailer implementation in a-mailer.js relies on this
    // implementation detail: DON'T CHANGE!
    // Explanation: A-Mailer relies on the fact that the ready hander is
    // called and has finished before the "idle" event is emitted, because
    // in sets a one-time "idle" handler.
    vertx.runOnContext(function () { self.emit("idle"); });
};
