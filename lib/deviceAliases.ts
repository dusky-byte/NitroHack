import fs from "fs";
import path from "path";

const ALIAS_FILE = path.join(process.cwd(), "device_aliases.json");

export function getAliases(): Record<string, string> {
  try {
    if (fs.existsSync(ALIAS_FILE)) {
      const data = fs.readFileSync(ALIAS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading device aliases:", error);
  }
  return {};
}

export function saveAlias(deviceId: string, alias: string) {
  const aliases = getAliases();
  if (alias) {
    aliases[deviceId] = alias;
  } else {
    delete aliases[deviceId];
  }
  try {
    fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliases, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing device aliases:", error);
  }
}
