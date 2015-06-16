var oscPathFreqBandMap = [  "/muse/elements/delta_absolute", "delta",
                            "/muse/elements/theta_absolute", "theta",
                            "/muse/elements/alpha_absolute", "alpha",
                            "/muse/elements/beta_absolute",  "beta",
                            "/muse/elements/gamma_absolute", "gamma" ];

var CHANNELS = [{name: 'T9',  index: 1},
                {name: 'Fp1', index: 2},
                {name: 'Fp2', index: 3},
                {name: 'T10', index: 4}],
    SELECTED_CHANS = [{name: 'T9', index: 1},
                      {name: 'Fp1', index: 2}];//default: T9 + Fp1

//Frequency band name and idx mapping
var FREQ_BANDS = [  {name: 'none', index: -1},
                    {name: 'delta', index: 0},
                    {name: 'theta', index: 1},
                    {name: 'alpha', index: 2},
                    {name: 'beta',  index: 3},
                    {name: 'gamma', index: 4}],
    SELECTED_FREQ_BANDS = [ {name: 'alpha', index: 2},
                            {name: 'beta', index: 3}];//default: alpha/beta

var MOV_AVG;

var DIVIDEND = [], DIVISOR = [];
var RATIO = [];
var RATIO_MIN = 0.5, RATIO_MAX = 0;
var REMAINING_BATTERY = 0;

var ExperimentController = require('./ExperimentController.js');

function MainController(){
    this.init();
}

MainController.prototype.init = function(){
    this.osc = require('./dependencies/node-osc/lib/osc');
    //WebSocket = require("websocket");
    var app = require('http').createServer(this.handler);
    this.io = require('socket.io')(app);
    var fs = require('fs');
    app.listen(80);

    var util = require('util');

    //moving average
    var MA = require('./dependencies/moving-average.js');
    var timeInterval = 60 * 1000; // 1 minute
    /*MOV_AVG = [ ['delta', 0, 0, 0, 0],
        ['theta', 0, 0, 0, 0],
        ['alpha', 0, 0, 0, 0],
        ['beta',  0, 0, 0, 0],
        ['gamma', 0, 0, 0, 0] ];
    for(var i = 0; i < FREQ_BANDS.length; i++){
        MOV_AVG[i][0] = FREQ_BANDS[i].name;
        CHANNELS.forEach(function(el, idx){
            MOV_AVG[i][el.index] = MA(timeInterval);
        });
    }*/

    this.experimentController = undefined;
    this.firstMessage = true;
    //connection to browser via WebSocket
    this.onWebSocketConnection();
};

MainController.prototype.handler = function(){
    return function(req, res) {
        fs.readFile(path.join(__dirname, '..', 'index.html'),
            function (err, data) {
                if (err) {
                    res.writeHead(500);
                    return res.end('Error loading index.html');
                }

                res.writeHead(200);
                res.end(data);
            });
    }
};

MainController.prototype.onWebSocketConnection = function(){
    var self = this;
    //connection with Browser via WebSocket
    this.io.on('connection', function (socket) {
        console.log("WebSocket connected..");
        //receive OSC messages on UDP port 5002 and refer them to index.html
        self.oscServer = new self.osc.Server(5002, '0.0.0.0');
        //listen for osc messages from muse
        self.oscListener(socket);

        /*** BLUE SIDEBAR ***/
            //channel selection lsitener
        self.channelSelectionListener(socket);
        //frequency band selection listener
        self.frequencyBandSelectionListener(socket);
    });
};

/**
 * New experiment button clicked + Age and Gender dialog submitted.
 * @param socket
 */
MainController.prototype.newExperimentListener = function(socket){
    var self = this;
    socket.on('newExperiment', function(data){//no data
        console.log('new experiment set up for ' + data.age + ', '+ data.gender + ', ' + 'mode: ' + data.mode);
        //init experiment with mode, gender  and age
        self.experimentController = new ExperimentController(data.age, data.gender, data.mode, socket);
        socket.emit('experimentCreated', { experimentCreated: true});
    });
};

//listen for "start experiment" btn press
MainController.prototype.startExperimentListener = function(socket){
    var self = this;
    socket.on('startExperimentButton', function(data){// data.mode = experiment mode idx
        if(typeof self.experimentController !== 'undefined'){ //data.duration = duration of experiment mode in seconds
            if(!data.resume) {// if experiment is started from the beginning
                //set duration in seconds, default = 60
                self.experimentController.setDuration(data.duration);
            }
            console.log('startExperimentButton clicked, mode: ' + data.mode);
            //set mode
            self.experimentController.setMode(data.mode);

            self.experimentController.setPercentileDividendIdx(data.percentiles[0]);
            self.experimentController.setPercentileDivisorIdx(data.percentiles[1]);
            switch(data.mode){
                //start CALIBRATION
                case 0:
                    self.experimentController.startExperimentMode(data.mode,
                        (function () {
                            console.log('experiment mode ' + data.mode + ' stopped.');
                            var res = self.experimentController.getQuantileResults(SELECTED_FREQ_BANDS[0].name,
                                SELECTED_FREQ_BANDS[1].name,
                                SELECTED_CHANS[0].index,
                                10,
                                SELECTED_CHANS[1].index,
                                10);
                            var error = true;
                            for(var i = 0; i < res.length; ++i) {
                                for(var j = 0; j < res[i].length; ++j) {
                                    if (res[i][j] !== 0) {
                                        error = false;
                                        break;
                                    }
                                }
                            }
                            socket.emit('experimentStopped', {mode: data.mode, percentiles: res, error: error});
                        })
                    );
                    break;
                //start TEST 1
                case 1:
                    self.experimentController.startExperimentMode(data.mode,(function (points) {
                            console.log('experiment mode ' + data.mode + ' stopped.');
                            socket.emit('experimentStopped', {mode: data.mode, points: points});
                        })
                    );
                    break;
                // start FREE NEUROFEEDBACK
                case 2:
                    self.experimentController.startExperimentMode(data.mode,(function () {
                            console.log('experiment mode ' + data.mode + ' stopped.');
                            socket.emit('experimentStopped', {mode: data.mode});
                        })
                    );
                    break;
                //start TEST 2
                case 3:
                    self.experimentController.startExperimentMode(data.mode,(function (points) {
                            console.log('experiment mode ' + data.mode + ' stopped.');
                            socket.emit('experimentStopped', {mode: data.mode, points: points});
                        })
                    );
                    break;
            }
        }
    });
};

MainController.prototype.pauseExperimentListener = function(socket){
    var self = this;
    socket.on('pauseExperimentButton', function(data){
        self.experimentController.setPausedByUser(true);
        self.experimentController.pauseExperiment();
    });
};

/**
 * Experiment mode radio button selection from UIController via socket.
 * @param socket
 */
MainController.prototype.experimentModeChangeListener = function(socket){
    var self = this;
    socket.on('experimentModeChanged', function(data){
        console.log('experiment mode changed to ' + data.mode + ', duration set to ' + data.duration);
        self.experimentController.setMode(data.mode);
        self.experimentController.setDuration(data.duration);
    });
};

MainController.prototype.channelSelectionListener = function(socket){
    var self = this;
    //receive channel selection changes
    socket.on('channelSelection', function (data) {
        console.log(data);
        data.selectedChannels.forEach(function (channel, idx) {
            SELECTED_CHANS[idx] = CHANNELS[channel];
        });
        console.log("amount channels: " + SELECTED_CHANS.length);
        // get quantiles from Calibration for newly selected channels and send them via websocket
        if(typeof self.experimentController !== 'undefined'){
            socket.emit('percentiles', {
                percentiles: self.experimentController.getQuantileResults(SELECTED_FREQ_BANDS[0].name, SELECTED_FREQ_BANDS[1].name,
                    SELECTED_CHANS[0].index, 10, SELECTED_CHANS[1].index, 10)
            });
        }

        //set RATIOS back to default
        RATIO_MAX = 0;
        RATIO_MIN = 0.5;
    });
};

MainController.prototype.frequencyBandSelectionListener = function(socket){
    var self = this;
    //receive frequency selection changes
    socket.on('frequencyBandSelection', function (data) {
        data.selectedFrequencyBands.forEach(function (band, idx) {
            SELECTED_FREQ_BANDS[idx] = FREQ_BANDS[band+1];
        });
        console.log(SELECTED_FREQ_BANDS);
        //get quantiles from Calibration for newly selected bands and send them over websocket
        if(self.experimentController !== undefined && self.experimentController.getCalibrationCollectionLength() !== 0){
            socket.emit('percentiles', {
                percentiles: self.experimentController.getQuantileResults(SELECTED_FREQ_BANDS[0].name, SELECTED_FREQ_BANDS[1].name,
                    SELECTED_CHANS[0].index, 10, SELECTED_CHANS[1].index, 10)
            });
        }

        //set RATIOS back to default
        RATIO_MAX = 0;
        RATIO_MIN = 0.5;
    });
};

MainController.prototype.oscListener = function(socket){
    var self = this;
    this.oscServer.on("message", function (msg) {
        if(self.firstMessage === true){//add listeners only when we are sure we are receiving data from muse
            //send muse connected message
            socket.emit('museConnected',{museConnected: true});

            /****** RED SIDEBAR ****/
            //listen for new experiment btn click
            self.newExperimentListener(socket);
            //listen for experiment start btn click
            self.startExperimentListener(socket);
            //listen for experiment pauses
            self.pauseExperimentListener(socket);
            //listen for experiment mode change
            self.experimentModeChangeListener(socket);
            self.firstMessage = false;
        }
        if (msg[0] === "/muse/elements/delta_absolute"
            || msg[0] === "/muse/elements/theta_absolute"
            || msg[0] === "/muse/elements/alpha_absolute"
            || msg[0] === "/muse/elements/beta_absolute"
            || msg[0] === "/muse/elements/gamma_absolute")
        {
            //CALIBRATION RUNNING
            if(typeof self.experimentController !== 'undefined'
                && self.experimentController.getExperimentRunning()
                && self.experimentController.getMode() === 0)
            {
                var collMsg = msg;
                collMsg[0] = getFrequencyBandByOSCPath(msg[0]);
                console.log('calibrating...');
                self.experimentController.addToCollection(collMsg);
            }

            SELECTED_FREQ_BANDS.forEach(function(selBand, selIdx)
            {
                /*CHANNELS.forEach(function(el, idx) {
                    //add values to moving average
                    MOV_AVG[selBand.index][el.index].push(Date.now(), Math.pow(10,msg[el.index]));
                    //console.log('moving average of ' + MOV_AVG[selBand.index][0] + ' now is', MOV_AVG[selBand.index][el.index].movingAverage());
                    // console.log('moving variance now is', MOV_AVG[selBand.index][el.index].variance());
                });*/

                if(msg[0].indexOf(selBand.name) !== -1)
                {
                    FREQ_BANDS.forEach(function(allBand, allIdx)
                    {
                        if( selBand.index === allBand.index )
                        {
                            if(selIdx === 0){
                                setDividend(selBand.name, msg.slice(1));
                                //console.log('DIVIDEND: ' + DIVIDEND);
                                if(SELECTED_FREQ_BANDS.length === 1)
                                    setDivisor('', [1,1,1,1]);
                                setRatio();

                                socket.emit('ratio', {ratio: RATIO});

                                if(typeof self.experimentController !== 'undefined'){
                                    self.experimentController.setRatio(RATIO[1]);
                                    if(!self.experimentController.getExperimentRunning())//todo: is this needed?
                                        self.experimentController.stopPointsTimer();
                                }
                                if(RATIO[1] > RATIO_MAX){
                                    RATIO_MAX = RATIO[1];
                                    if(typeof self.experimentController !== 'undefined' && self.experimentController.getExperimentRunning())
                                        self.experimentController.setRatioMax(RATIO[1]);
                                    socket.emit('ratio_max',{ratio_max: RATIO_MAX});
                                }
                                if(RATIO[1] < RATIO_MIN){
                                    RATIO_MIN = RATIO[1];
                                    if(typeof self.experimentController !== 'undefined' && self.experimentController.getExperimentRunning())
                                        self.experimentController.setRatioMin(RATIO[1]);
                                    socket.emit('ratio_min',{ratio_min: RATIO_MIN});
                                }

                            }else if(selIdx === 1){
                                //console.log(allBand.name + ': ' + msg);
                                setDivisor(selBand.name, msg.slice(1));
                                //console.log('DIVISOR: ' + DIVISOR);
                                setRatio();

                                socket.emit('ratio', {ratio: RATIO});

                                if(typeof self.experimentController !== 'undefined'){
                                    self.experimentController.setRatio(RATIO[1]);
                                    if(!self.experimentController.getExperimentRunning())
                                        self.experimentController.stopPointsTimer();
                                }
                                if(RATIO[1] > RATIO_MAX){
                                    RATIO_MAX = RATIO[1];
                                    if(typeof self.experimentController !== 'undefined' && self.experimentController.getExperimentRunning())
                                        self.experimentController.setRatioMax(RATIO[1]);
                                    socket.emit('ratio_max',{ratio_max: RATIO_MAX});
                                }
                                if(RATIO[1] < RATIO_MIN){
                                    RATIO_MIN = RATIO[1];
                                    if(typeof self.experimentController !== 'undefined' && self.experimentController.getExperimentRunning())
                                        self.experimentController.setRatioMin(RATIO[1]);
                                    socket.emit('ratio_min',{ratio_min: RATIO_MIN});
                                }
                            }
                        }
                    });
                }
            });
        /*****************HORSESHOE*******************/
        }else if(msg[0] === '/muse/elements/horseshoe')//four integers (for each channel)
        {
            socket.emit('horseshoe', {horseshoe: msg});
        }
        /******************TOUCHING FOREHEAD**************************/
        else if(msg[0] === '/muse/elements/touching_forehead') //one integer
        {
            if(self.experimentController !== undefined){
                var remainingDuration = self.experimentController.getDuration();
                if(self.experimentController.getTouchingForehead() !== msg[1])
                    self.experimentController.setTouchingForehead(msg);
                if(msg[1] !== 1 && self.experimentController.getExperimentRunning()) // PAUSE EXPERIMENT
                {
                    //pause experiment
                    console.log('WARNING: Experiment paused. Muse is not touching forehead. ');
                    self.experimentController.pauseExperiment();//sets experimentRunning to false
                    socket.emit('notTouchingForehead', {pauseExperiment: true, remainingDuration: remainingDuration});
                }
                else if(msg[1] === 1 && self.experimentController.getExperimentPaused()
                    && !self.experimentController.getPausedByUser() && remainingDuration > 0)
                { //RESUME REXPERIMENT
                    socket.emit('touchingForehead', {resumeExperiment: true, remainingDuration: remainingDuration});
                    console.log('INFO: Experiment resumed. Muse is placed on head.');
                    self.experimentController.resumeExperiment(
                        (function () {//callback
                            var res = self.experimentController.getQuantileResults(SELECTED_FREQ_BANDS[0].name,
                                SELECTED_FREQ_BANDS[1].name,
                                SELECTED_CHANS[0].index,
                                10,
                                SELECTED_CHANS[1].index,
                                10);
                            var error = true;
                            for(var i = 0; i < res.length; ++i) {
                                for(var j = 0; j < res[i].length; ++j) {
                                    if (res[i][j] !== 0) {
                                        error = false;
                                        break;
                                    }
                                }
                            }
                            socket.emit('experimentStopped', {mode: self.experimentController.getMode(), percentiles: res, error: error});
                        })
                    );
                }
            }
        }
        /***********************BATTERY*************************/
        else if(msg[0] === '/muse/batt'){//four integers. idx 0 is battery precentage remaining (divide by 100)
            var charge = Math.round(msg[1]/100);
           // console.log(charge);
            if(REMAINING_BATTERY !== charge){
                REMAINING_BATTERY = charge;
                socket.emit('batteryUpdate', {charge: charge});
            }

        }
        /*********************** BLINK AND JAW CLENCH ************************/
        else if(msg[0] === '/muse/elements/blink'){
            socket.emit('blink', {blink: msg[1]});
        }
        else if(msg[0] === '/muse/elements/jaw_clench'){
            socket.emit('jawClench', {jawClench: msg[1]});
        }
    });
};

function getFrequencyBandByOSCPath(oscPath){
    return bandName = oscPathFreqBandMap[oscPathFreqBandMap.indexOf(oscPath)+1];
}

function setDividend(freqBandName, data){
    var medFreq = 0;
    var chanCount = 0;
    SELECTED_CHANS.forEach(function(el, idx){
        medFreq += data[el.index-1];
        chanCount++;
    });
    DIVIDEND = [freqBandName, medFreq/chanCount];
}

function setDivisor(freqBandName, data){
    var medFreq = 0;
    var chanCount = 0;
    SELECTED_CHANS.forEach(function(el, idx){
        medFreq += data[el.index-1];
        chanCount++;
    });
    DIVISOR = [freqBandName, medFreq/chanCount];
}

function setRatio(){
    RATIO = [DIVIDEND[0] + '/' + DIVISOR[0], (Math.pow(10, DIVIDEND[1])/Math.pow(10, DIVISOR[1]))];
}

new MainController();