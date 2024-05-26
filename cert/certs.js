const P12S = [{
    filename: 'token.p12', // p12 token name that must be located in cert/
    password: process.env.DIGITAL_SIGNTURE_PASSWORD,
}];


module.exports = {
    P12S
}