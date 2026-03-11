const timeZones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [
        "UTC",
        "America/New_York",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney"
    ];

const SLOT_MINUTES = 30;
const MAX_DAYS_TO_SCAN = 3;

// CLDR exemplar city names for IANA IDs where the identifier uses an outdated spelling.
// The IANA ID is kept as-is for all calculations; only display names change.
const CLDR_CITY_OVERRIDES = {
    "Africa/Asmera":       "Asmara",
    "America/Godthab":     "Nuuk",
    "Asia/Ashkhabad":      "Ashgabat",
    "Asia/Calcutta":       "Kolkata",
    "Asia/Dacca":          "Dhaka",
    "Asia/Katmandu":       "Kathmandu",
    "Asia/Rangoon":        "Yangon",
    "Asia/Saigon":         "Ho Chi Minh City",
    "Asia/Thimbu":         "Thimphu",
    "Asia/Ulaanbaatar":    "Ulaanbaatar",
    "Pacific/Ponape":      "Pohnpei",
    "Pacific/Truk":        "Chuuk"
};

/**
 * Returns a CLDR-correct city label for an IANA timezone ID.
 * Falls back to splitting the IANA ID on "/" and humanising the last segment.
 */
function getCityLabel(ianaId) {
    if (CLDR_CITY_OVERRIDES[ianaId]) return CLDR_CITY_OVERRIDES[ianaId];
    return ianaId.split("/").pop().replace(/_/g, " ");
}

/**
 * Accepts either a plain IANA ID ("Asia/Kolkata") or the autocomplete format
 * "Kolkata (Asia/Kolkata)" and returns the IANA ID, or null if unrecognised.
 */
function extractIanaId(rawInput) {
    const parenMatch = rawInput.match(/\(([^)]+)\)$/);
    if (parenMatch && timeZones.includes(parenMatch[1])) return parenMatch[1];
    if (timeZones.includes(rawInput)) return rawInput;
    return null;
}

const participantCards = Array.from(document.querySelectorAll(".participant"));
const toggleThirdButton = document.getElementById("toggle-third");
const findTimesButton = document.getElementById("find-times");
const resultsSection = document.getElementById("results");
const resultsBody = document.getElementById("results-body");
const timeZoneList = document.getElementById("tz-list");
const errorMessage = document.getElementById("error-message");
const meetingDateInput = document.getElementById("meeting-date");

const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
});

function populateTimeZoneList() {
    const options = timeZones.map((zone) => {
        const city = getCityLabel(zone);
        return `<option value="${city} (${zone})"></option>`;
    }).join("");
    timeZoneList.innerHTML = options;
}

function buildHourOptions(selectElement, defaultValue) {
    const options = [];
    for (let hour = 0; hour < 24; hour += 1) {
        const label = formatHourLabel(hour);
        options.push(`<option value="${hour}"${hour === defaultValue ? " selected" : ""}>${label}</option>`);
    }
    selectElement.innerHTML = options.join("");
}

function formatHourLabel(hour) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${normalizedHour}:00 ${suffix}`;
}

function setupHourSelectors() {
    participantCards.forEach((card) => {
        buildHourOptions(card.querySelector(".work-start"), 9);
        buildHourOptions(card.querySelector(".work-end"), 17);
    });
}

function setupDefaultTimeZones() {
    const defaults = ["America/New_York", "Europe/London", "Asia/Tokyo"];
    participantCards.forEach((card, index) => {
        const input = card.querySelector(".tz-input");
        const ianaId = defaults[index];
        input.value = ianaId ? `${getCityLabel(ianaId)} (${ianaId})` : "";
    });
}

function getVisibleParticipants() {
    return participantCards.filter((card) => !card.classList.contains("hidden"));
}

function getTimeZoneParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });

    const parts = formatter.formatToParts(date);
    const values = {};
    parts.forEach((part) => {
        if (part.type !== "literal") {
            values[part.type] = Number(part.value);
        }
    });

    return values;
}

function zonedDateTimeToUtc(timeZone, year, month, day, hour) {
    const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
    const zoneParts = getTimeZoneParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
        zoneParts.year,
        zoneParts.month - 1,
        zoneParts.day,
        zoneParts.hour,
        zoneParts.minute,
        zoneParts.second
    );
    return new Date(guess - (asUtc - guess));
}

function getLocalDateInZone(date, timeZone) {
    const parts = getTimeZoneParts(date, timeZone);
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day
    };
}

function addLocalDays(localDate, dayOffset) {
    const date = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + dayOffset));
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function validateParticipant(card, index) {
    const raw = card.querySelector(".tz-input").value.trim();
    const startHour = Number(card.querySelector(".work-start").value);
    const endHour = Number(card.querySelector(".work-end").value);

    if (!raw) {
        throw new Error(`Participant ${index + 1} needs a time zone.`);
    }

    const timeZone = extractIanaId(raw);
    if (!timeZone) {
        throw new Error(`"${raw}" is not a recognised time zone. Choose one from the suggestions.`);
    }

    if (startHour === endHour) {
        throw new Error(`Participant ${index + 1} must have different start and end times.`);
    }

    return { timeZone, startHour, endHour };
}

function createAvailabilityWindows(participant, baseDate) {
    const baseLocalDate = getLocalDateInZone(baseDate, participant.timeZone);
    const windows = [];

    for (let dayOffset = 0; dayOffset < MAX_DAYS_TO_SCAN; dayOffset += 1) {
        const startDateLocal = addLocalDays(baseLocalDate, dayOffset);
        const endDateLocal = { ...startDateLocal };

        if (participant.endHour <= participant.startHour) {
            const nextDate = addLocalDays(startDateLocal, 1);
            endDateLocal.year = nextDate.year;
            endDateLocal.month = nextDate.month;
            endDateLocal.day = nextDate.day;
        }

        const startUtc = zonedDateTimeToUtc(
            participant.timeZone,
            startDateLocal.year,
            startDateLocal.month,
            startDateLocal.day,
            participant.startHour
        );
        const endUtc = zonedDateTimeToUtc(
            participant.timeZone,
            endDateLocal.year,
            endDateLocal.month,
            endDateLocal.day,
            participant.endHour
        );

        windows.push({ start: startUtc, end: endUtc });
    }

    return windows;
}

function intersectWindows(windowSets) {
    const overlaps = [];
    const maxLength = Math.max(...windowSets.map((set) => set.length));

    for (let index = 0; index < maxLength; index += 1) {
        const currentWindowSet = windowSets.map((set) => set[index]).filter(Boolean);
        if (currentWindowSet.length !== windowSets.length) {
            continue;
        }

        const start = new Date(Math.max(...currentWindowSet.map((window) => window.start.getTime())));
        const end = new Date(Math.min(...currentWindowSet.map((window) => window.end.getTime())));

        if (end.getTime() - start.getTime() >= SLOT_MINUTES * 60 * 1000) {
            overlaps.push({ start, end });
        }
    }

    return overlaps;
}

function createSuggestions(overlaps) {
    const suggestions = [];

    overlaps.forEach((window) => {
        const startTime = window.start.getTime();
        const endTime = window.end.getTime();

        for (let time = startTime; time + SLOT_MINUTES * 60 * 1000 <= endTime; time += SLOT_MINUTES * 60 * 1000) {
            suggestions.push({
                start: new Date(time),
                end: new Date(time + SLOT_MINUTES * 60 * 1000)
            });
        }
    });

    return suggestions.slice(0, 6);
}

function setupDateInput() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    meetingDateInput.value = `${yyyy}-${mm}-${dd}`;
}

function parseDateInput(value) {
    if (!value) {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    }
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function formatLocalHour(utcMs, timeZone) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(new Date(utcMs));
}

function renderTimeline(participants, baseDate) {
    const container = document.getElementById("timeline-container");
    const year = baseDate.getUTCFullYear();
    const month = baseDate.getUTCMonth() + 1;
    const day = baseDate.getUTCDate();
    const hourMs = 60 * 60 * 1000;

    // Compute each participant's working window in UTC for the chosen date.
    // DST is handled automatically because zonedDateTimeToUtc resolves the
    // offset that is actually in effect on that specific calendar date.
    const windows = participants.map((p) => {
        const localStart = { year, month, day };
        const localEnd = p.endHour <= p.startHour ? addLocalDays(localStart, 1) : localStart;
        return {
            startMs: zonedDateTimeToUtc(p.timeZone, year, month, day, p.startHour).getTime(),
            endMs: zonedDateTimeToUtc(p.timeZone, localEnd.year, localEnd.month, localEnd.day, p.endHour).getTime()
        };
    });

    const HOURS = 24;
    const hourAvail = [];
    for (let h = 0; h < HOURS; h++) {
        const slotStartMs = Date.UTC(year, month - 1, day, h, 0, 0);
        const slotEndMs = slotStartMs + hourMs;
        hourAvail.push(windows.map((w) => slotStartMs >= w.startMs && slotEndMs <= w.endMs));
    }

    const dateLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
    }).format(baseDate);

    let headerCells = '<div class="tl-label"><small>Timezone / Hours</small></div>';
    for (let h = 0; h < HOURS; h++) {
        const label = h % 3 === 0 ? String(h).padStart(2, "0") : "";
        headerCells += `<div class="tl-cell tl-hour-label">${label}</div>`;
    }

    let participantRows = "";
    participants.forEach((p, pi) => {
        const shortTz = getCityLabel(p.timeZone);
        const labelHtml = `<div class="tl-label"><span class="tl-tz-name">${shortTz}</span><br><small class="tl-tz-full">${p.timeZone}</small><br><small>${formatHourLabel(p.startHour)} \u2013 ${formatHourLabel(p.endHour)}</small></div>`;
        let cells = labelHtml;
        for (let h = 0; h < HOURS; h++) {
            const slotMs = Date.UTC(year, month - 1, day, h, 0, 0);
            const isAvail = hourAvail[h][pi];
            const allAvail = hourAvail[h].every(Boolean);
            let cls = "tl-cell ";
            if (isAvail && allAvail && participants.length > 1) {
                cls += "tl-overlap";
            } else if (isAvail) {
                cls += "tl-available";
            } else {
                cls += "tl-unavailable";
            }
            const tip = `${formatLocalHour(slotMs, p.timeZone)} (local)`;
            cells += `<div class="${cls}" title="${tip}" aria-label="${tip}"></div>`;
        }
        participantRows += `<div class="tl-row">${cells}</div>`;
    });

    container.innerHTML = `
        <h3 class="tl-title">Availability on ${dateLabel} <small class="tl-utc-note">(hours shown in UTC)</small></h3>
        <div class="timeline-wrapper">
            <div class="timeline">
                <div class="tl-row tl-header">${headerCells}</div>
                ${participantRows}
            </div>
        </div>
        <div class="tl-legend">
            <span><span class="legend-swatch tl-unavailable"></span> Outside working hours</span>
            <span><span class="legend-swatch tl-available"></span> Working hours</span>
            <span><span class="legend-swatch tl-overlap"></span> Overlap (all available)</span>
        </div>
    `;
}

function formatInTimeZone(date, timeZone) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit"
    }).format(date);
}

function renderResults(participants, overlaps, suggestions, baseDate) {
    resultsSection.classList.remove("hidden");
    renderTimeline(participants, baseDate);

    if (!overlaps.length) {
        resultsBody.innerHTML = '<div class="empty-state">No shared availability was found for this date range. Try widening the working hours.</div>';
        return;
    }

    const overlapCards = overlaps.map((window, index) => {
        const participantTimes = participants.map((participant, participantIndex) => {
            return `<p class="result-meta">Participant ${participantIndex + 1} — ${getCityLabel(participant.timeZone)} (${participant.timeZone}): ${formatInTimeZone(window.start, participant.timeZone)} - ${formatInTimeZone(window.end, participant.timeZone)}</p>`;
        }).join("");

        return `
            <div class="result-card">
                <p class="result-title">Overlap window ${index + 1}</p>
                <p class="result-meta">Your local time: ${dateFormatter.format(window.start)} - ${dateFormatter.format(window.end)}</p>
                ${participantTimes}
            </div>
        `;
    }).join("");

    const suggestionCards = suggestions.map((slot, index) => {
        return `
            <div class="result-card">
                <p class="result-title">Suggested meeting ${index + 1}</p>
                <p class="result-meta">Your local time: ${dateFormatter.format(slot.start)} - ${dateFormatter.format(slot.end)}</p>
                <p class="result-note">This is a ${SLOT_MINUTES}-minute slot inside a shared overlap window.</p>
            </div>
        `;
    }).join("");

    resultsBody.innerHTML = `${suggestionCards}${overlapCards}`;
}

function calculateMeetingTimes() {
    errorMessage.textContent = "";

    try {
        const visibleCards = getVisibleParticipants();
        const participants = visibleCards.map((card, index) => validateParticipant(card, index));
        const baseDate = parseDateInput(meetingDateInput.value);
        const windowSets = participants.map((participant) => createAvailabilityWindows(participant, baseDate));
        const overlaps = intersectWindows(windowSets);
        const suggestions = createSuggestions(overlaps);
        renderResults(participants, overlaps, suggestions, baseDate);
    } catch (error) {
        resultsSection.classList.remove("hidden");
        resultsBody.innerHTML = "";
        errorMessage.textContent = error.message;
    }
}

function toggleThirdParticipant() {
    const thirdParticipant = participantCards[2];
    const isHidden = thirdParticipant.classList.contains("hidden");
    thirdParticipant.classList.toggle("hidden", !isHidden);
    toggleThirdButton.textContent = isHidden ? "Remove Participant 3" : "+ Add Participant 3";

    if (!isHidden) {
        thirdParticipant.querySelector(".tz-input").value = "";
    }
}

populateTimeZoneList();
setupHourSelectors();
setupDefaultTimeZones();
setupDateInput();
findTimesButton.addEventListener("click", calculateMeetingTimes);
toggleThirdButton.addEventListener("click", toggleThirdParticipant);
calculateMeetingTimes();
