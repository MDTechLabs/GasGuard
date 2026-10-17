const serialize = require("node-serialize");
const yaml = require("js-yaml");

function handleProfile(req, res) {
  const profile = serialize.unserialize(req.body.profile);
  res.json(profile);
}

function handleConfig(req, res) {
  const config = yaml.unsafeLoad(req.body.config);
  res.json(config);
}

module.exports = { handleProfile, handleConfig };
