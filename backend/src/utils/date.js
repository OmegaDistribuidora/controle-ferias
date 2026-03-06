const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(utc);
dayjs.extend(customParseFormat);

function parseDateInput(value) {
  if (!value) return null;
  const parsed = dayjs.utc(value, ["YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss[Z]"], true);
  if (!parsed.isValid()) {
    throw new Error("Data invalida.");
  }
  return parsed.hour(12).minute(0).second(0).millisecond(0).toDate();
}

function formatDate(date) {
  if (!date) return null;
  return dayjs.utc(date).format("YYYY-MM-DD");
}

function todayUtc() {
  return dayjs.utc().startOf("day");
}

module.exports = {
  dayjs,
  parseDateInput,
  formatDate,
  todayUtc,
};
