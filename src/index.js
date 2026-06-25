const { initDevLens } = require('./server/interceptor');
const { initDevLensClientLegacy } = require('./client/interceptor');

module.exports = {
  initDevLens,
  initDevLensClient: initDevLensClientLegacy
};