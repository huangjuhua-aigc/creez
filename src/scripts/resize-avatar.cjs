const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "assets", "roundcloser.png");
const tmp = src + ".tmp";

sharp(src)
  .resize(256, 256, { fit: "inside", withoutEnlargement: true })
  .png({ compressionLevel: 6 })
  .toFile(tmp)
  .then(() => {
    fs.renameSync(tmp, src);
    console.log("Resized roundcloser.png to max 256px");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
