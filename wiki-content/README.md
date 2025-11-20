# Wiki Content - Upload Instructions

This directory contains markdown files for the GitHub wiki.

## Wiki Pages Created

1. **Home.md** - Main wiki landing page
2. **Installation.md** - Installation instructions for end users
3. **Building.md** - Build instructions for developers
4. **Architecture.md** - Technical architecture overview
5. **Artifacts.md** - Guide to downloading and using GitHub Actions artifacts
6. **Development.md** - Development guide for contributors
7. **Sample-Prompts.md** - Implementation documentation for the sample prompts feature

## How to Upload to GitHub Wiki

### Method 1: Using GitHub Web Interface (Recommended)

1. **Enable Wiki** (if not already enabled):
   - Go to: `https://github.com/gdcorp-engineering/ans-browser-extension/settings`
   - Scroll to **Features** section
   - Check **Wikis**
   - Click **Save**

2. **Create Wiki Pages**:
   - Go to: `https://github.com/gdcorp-engineering/ans-browser-extension/wiki`
   - Click **Create the first page** (or **New Page** if wiki exists)
   - For each markdown file in this directory:
     - Copy the content from the .md file
     - Paste into the GitHub wiki editor
     - Use the filename (without .md) as the page title
     - Click **Save Page**

3. **Create Pages in This Order**:
   - Home (will be the landing page)
   - Installation
   - Building
   - Development
   - Architecture
   - Artifacts
   - Sample-Prompts

### Method 2: Using Git (Advanced)

Once the wiki is enabled, you can clone and push:

```bash
# Clone wiki repository
git clone https://github.com/gdcorp-engineering/ans-browser-extension.wiki.git

# Copy markdown files
cd ans-browser-extension.wiki
cp ../wiki-content/*.md .

# Remove this README (not needed in wiki)
rm README.md

# Commit and push
git add .
git commit -m "docs: add comprehensive wiki documentation"
git push origin master
```

## Page Descriptions

### Home.md
- Overview of the extension
- Key features
- Quick links to other wiki pages
- Current version

### Installation.md
- Step-by-step installation from GitHub Actions artifacts
- Step-by-step installation from source build
- Configuration instructions (API keys)
- Troubleshooting common installation issues

### Building.md
- Prerequisites
- Clone and setup instructions
- Building for different environments (dev/test/prod)
- Build output structure
- Development workflow

### Architecture.md
- High-level system architecture
- Component descriptions (sidebar, background, content script)
- Data flow diagrams
- Tool execution flow
- File structure
- Security considerations

### Artifacts.md
- What artifacts are and why there are two types
- How to download from GitHub Actions
- Installation from ZIP package
- Installation from unzipped folder
- Artifact retention policy
- Triggering new builds

### Development.md
- Getting started for contributors
- Project structure
- Development workflow
- Adding new browser tools
- Modifying UI
- Testing
- Code style guide
- Commit message format
- Common issues and solutions

### Sample-Prompts.md
- Feature overview and architecture
- Page analysis and type detection
- Prompt generation logic
- Implementation details
- Code structure and extensibility
- Examples and troubleshooting

## Verification

After uploading, verify:

1. **Navigation Links Work**: Click links between pages
2. **Images Display**: If any images are added later
3. **Code Blocks Format**: Check syntax highlighting
4. **Tables Render**: Verify table formatting

## Maintenance

Keep these wiki pages updated when:
- Version changes (update Home.md)
- New features added (update Architecture.md, Development.md)
- Build process changes (update Building.md)
- Installation steps change (update Installation.md)
- New artifact types added (update Artifacts.md)
