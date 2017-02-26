require('dotenv').config();

const {
  LASTFM_API,
  LASTFM_SECRET,
  LASTFM_USERAGENT,
  LASTFM_USERNAME,
  PRINTER_USB,
  PRINTER_BAUDRATE,
  PRINTER_ROTATION
} = process.env;

if (
  !LASTFM_API ||
  !LASTFM_SECRET ||
  !LASTFM_USERAGENT ||
  !LASTFM_USERNAME ||
  !PRINTER_USB ||
  !PRINTER_BAUDRATE ||
  !PRINTER_ROTATION
) {
  return console.error('Missing environment variabes.');
}

const SerialPort = require('serialport');
const serialPort = new SerialPort(PRINTER_USB, { baudrate: +PRINTER_BAUDRATE });
const Printer = require('thermalprinter');

const PRINT_WIDTH = 384;

const request = require('request');
const LastFmNode = require('lastfm').LastFmNode;
const lastfm = new LastFmNode({
  api_key: LASTFM_API, // sign-up for a key at http://www.last.fm/api
  secret:  LASTFM_SECRET,
  useragent: LASTFM_USERAGENT
});

const gm = require('gm');

serialPort.on('open', _ => {
  console.log('Serial port open!');

  /*
    maxPrintingDots = 0-255. Max heat dots, Unit (8dots), Default: 7 (64 dots)
    heatingTime = 3-255. Heating time, Unit (10us), Default: 80 (800us)
    heatingInterval = 0-255. Heating interval, Unit (10µs), Default: 2 (20µs)

    The more max heating dots, the more peak current will cost when printing,
    the faster printing speed. The max heating dots is 8*(n+1).

    The more heating time, the more density, but the slower printing speed.
    If heating time is too short, blank page may occur.

    The more heating interval, the more clear, but the slower printing speed.
  */

  const printer = new Printer(serialPort, {
		maxPrintingDots: 10,
		heatingTime: 150,
		heatingInterval: 120,
		commandDelay: 2
	});

  printer.on('ready', _ => {
    console.log('Printer ready!');

    const trackStream = lastfm.stream(LASTFM_USERNAME);

    trackStream.on('error', error => {
      if (error.message) {
        return console.error('Error: ', error.message);
      }
    });

    trackStream.on('nowPlaying', track => {
      console.log('Paused track stream');
      trackStream.stop();

      getTrackInfo(track)
        .then(getAndDitherImage)
        .then(imagePath => {
          console.log(`Image save to: ${imagePath}`);

          printer.printImage(imagePath).lineFeed(2).print(_ => {
            console.log('Printed image');

            console.log('Resumed track stream');
            trackStream.start();
          });
        })
        .catch(error => {
          console.error(error);

          console.log('Resumed track stream');
          trackStream.start();
        });
    });

    trackStream.start();
  });
});

const getAndDitherImage = (track) => new Promise((resolve, reject) => {
  console.log('Dithering album art');

  if (!track) {
    return reject('Missing `track`');
  }

  const imageFilename = track.imageUrl.substr(track.imageUrl.lastIndexOf('/'));
  const imagePath = `${__dirname}/images/${imageFilename}`;

  const FONT_SIZE = 16;
  const TEXT_MAX_LENGTH = 22;

  function processText(text) {
    text = text.toUpperCase();

    if (text.length <= TEXT_MAX_LENGTH) {
      return text;
    }

    return text.substr(0, TEXT_MAX_LENGTH - 1) + '…';
  }

  function niceDate() {
    let date = new Date().toISOString();
    date = date.replace('T', '                                    ').replace('Z', ' ');
    date = date.substr(0, date.lastIndexOf(':'));
    return date.trim();
  }

  gm(request(track.imageUrl), imageFilename)
    // make the image cripser, black and white and then dither
    .sharpen(5)
    .monochrome()

    .dither()

    .borderColor('#000')
    .border(1, 1)

    // center on a white background the size of the printer paper
    .gravity('Center')
    .extent(PRINT_WIDTH, PRINT_WIDTH)

    .fill('#000')
    .font(`${__dirname}/fonts/source-sans-pro-700.ttf`, FONT_SIZE)

    // put text on each side
    .drawText(0, FONT_SIZE, processText(track.name), 'North').rotate('#fff', 90)

    .font(`${__dirname}/fonts/source-sans-pro-700-italic.ttf`, FONT_SIZE)
    .drawText(0, FONT_SIZE, processText(track.artist), 'North').rotate('#fff', -180)
    .drawText(0, FONT_SIZE, processText(track.album), 'North').rotate('#fff', 90)

    .font(`${__dirname}/fonts/source-sans-pro-600.ttf`, FONT_SIZE)
    .drawText(0, FONT_SIZE, niceDate(), 'South')

    // finally rotate, depending on the orientation of the printer
    .rotate('#fff', PRINTER_ROTATION)

    .write(imagePath, error => {
      if (error) {
        return reject(error);
      }

      resolve(imagePath);
    });
});

const getTrackInfo = (data) => new Promise((resolve, reject) => {
  console.log('Getting track info');

  if (!data || !data.image || data.image.length <= 0) {
    return reject('No album art');
  }

  const track = {
    name: data.name,
    imageUrl: data.image[3]['#text'],
    artist: data.artist['#text'],
    album: data.album['#text']
  };


  // if album art
  if (!track || track.imageUrl.length <= 0) {
    return reject('No album art');
  }

  console.log(`Track info: ${track.name} - ${track.artist} - ${track.album}`);
  console.log(`Track image url: ${track.imageUrl}`);

  resolve(track);
});
