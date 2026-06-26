const { initDevLens } = require('./server/interceptor');
const { initDevLensClient } = require('./client/interceptor');

module.exports = {
  initDevLens,
  initDevLensClient,
};