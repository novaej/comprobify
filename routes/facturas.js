
const { Router } = require('express');
const { check } = require('express-validator');

const { facturaGet } = require('../controllers/facturas');


const router = Router();

router.get('/', facturaGet);



module.exports = router;