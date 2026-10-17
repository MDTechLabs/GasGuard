const yaml = require("js-yaml");

function handleProfile(req, res) {
  const profile = JSON.parse(req.body.profile);
  res.json(profile);
}

function handleConfig(req, res) {
  const config = yaml.safeLoad(req.body.config);
  res.json(config);
}

module.exports = { handleProfile, handleConfig };
