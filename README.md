# NSR Barcode Generator CLI

A simple, modern TypeScript CLI tool that reads and echoes the contents of a file.

## Features

- 🚀 Modern TypeScript with strict type checking
- 📦 Built with Commander.js for robust CLI parsing
- 🛠️ Clean architecture with separated concerns
- ⚡ Fast development with tsx
- 🔧 Easy to build and maintain

## Installation

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build
```

## Usage

### Development

```bash
# Run in development mode
pnpm run dev <file-path>

# Example
pnpm run dev ./example.txt
```

### Production

```bash
# Build and run
pnpm run build
pnpm start <file-path>

# Or use the binary directly after building
./dist/index.js <file-path>
```

### Command Line Options

```bash
# Show help
nsr-barcode --help

# Show version
nsr-barcode --version

# Read a file
nsr-barcode path/to/your/file.txt
```

## Development Scripts

- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run dev` - Run in development mode with tsx
- `pnpm run watch` - Watch for changes and rebuild
- `pnpm run clean` - Clean the dist directory
- `pnpm start` - Run the built application

## Project Structure

```
src/
├── index.ts           # Main CLI entry point
└── utils/
    └── fileReader.ts  # File reading utility
```

## Architecture

The project follows a clean architecture pattern:

- **Entry Point** (`src/index.ts`): Handles CLI argument parsing and orchestrates the application flow
- **Utilities** (`src/utils/`): Contains reusable utility functions with proper error handling
- **Configuration**: Modern TypeScript configuration with strict type checking

## Error Handling

The tool provides user-friendly error messages for common scenarios:

- File not found
- Permission denied
- Directory instead of file
- Other file system errors

## Requirements

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- TypeScript 5.x
