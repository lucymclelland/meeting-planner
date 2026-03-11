# Meeting Planner

A browser-based tool for finding overlapping meeting times across up to three time zones.

## Features

- Select up to three IANA time zones (e.g. `America/New_York`, `Europe/London`, `Asia/Tokyo`)
- Define custom working hours per participant (e.g. 9 am – 5 pm)
- Calculates shared availability windows across the next few days
- Suggests 30-minute meeting slots within those windows
- No build step, no dependencies — runs directly in any modern browser

## Usage

1. Open `index.html` in your browser
2. Enter a time zone for each participant (autocomplete is provided)
3. Set working hours for each participant
4. Click **Find Meeting Times** to see suggested slots
5. Optionally add a third participant with the **+ Add Participant 3** button

## Project Structure

```
meeting-planner/
├── index.html   # App markup
├── styles.css   # Styling
└── script.js    # Timezone logic and UI
```

## Browser Support

Requires a browser with [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat) support (all modern browsers).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

MIT
