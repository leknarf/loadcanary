// Add all nodeload libraries into the global namespace
process.mixin(GLOBAL, require('http'), require('./monitor'), require('./scheduler'), require('./stats'), require('./httpreport'));
