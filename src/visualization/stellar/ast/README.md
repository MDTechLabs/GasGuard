# Soroban AST Visualization Exporter

Export visual representations of parsed AST structures for Soroban smart contracts.

## Overview

This module provides functionality to convert parsed AST (Abstract Syntax Tree) structures from Soroban contracts into visual graph representations. It supports multiple output formats and can handle large AST structures through intelligent chunking.

## Features

- **Multiple Output Formats**: Export to PNG, SVG, DOT, or JSON
- **Graph Visualization**: Uses Graphviz for high-quality graph rendering
- **Large AST Support**: Handles large AST structures through node limiting and chunking
- **Customizable Styling**: Configure colors, fonts, and layout options
- **Type Information**: Optionally show type information and line numbers
- **Batch Export**: Export to multiple formats simultaneously

## Installation

### Requirements

- Python 3.7+
- Graphviz (for PNG and SVG export): [Download Graphviz](https://graphviz.org/download/)

### Install Graphviz

**Windows:**
```bash
# Using chocolatey
choco install graphviz

# Or download from https://graphviz.org/download/
```

**macOS:**
```bash
brew install graphviz
```

**Linux:**
```bash
sudo apt-get install graphviz
```

## Usage

### Basic Usage

```python
from src.visualization.stellar.ast import ASTExporter, OutputFormat

# Sample AST data (from parsed Soroban contract)
ast_data = {
    "language": "Rust",
    "source": "pub struct Contract;",
    "file_path": "contract.rs",
    "contracts": [
        {
            "name": "MyContract",
            "functions": [
                {
                    "name": "initialize",
                    "params": [{"name": "admin", "type_name": "Address"}],
                    "return_type": None,
                    "visibility": "Public",
                    "decorators": [],
                    "is_constructor": True,
                    "is_external": True,
                    "is_payable": False,
                    "line_number": 10,
                    "body_raw": "{}"
                }
            ],
            "state_variables": [],
            "line_number": 1
        }
    ],
    "structs": [],
    "enums": []
}

# Create exporter
exporter = ASTExporter()

# Export to PNG
exporter.export(ast_data, "output/ast_visualization.png", OutputFormat.PNG)

# Export to SVG
exporter.export(ast_data, "output/ast_visualization.svg", OutputFormat.SVG)

# Export to DOT (Graphviz format)
exporter.export(ast_data, "output/ast_visualization.dot", OutputFormat.DOT)

# Export to JSON
exporter.export(ast_data, "output/ast_visualization.json", OutputFormat.JSON)
```

### Advanced Configuration

```python
from src.visualization.stellar.ast import ASTExporter, VisualizationConfig, OutputFormat

# Create custom configuration
config = VisualizationConfig(
    max_nodes=500,              # Limit to 500 nodes
    max_depth=50,               # Limit traversal depth
    show_line_numbers=True,     # Show line numbers in tooltips
    show_types=True,            # Show type information
    collapse_similar=True,      # Collapse similar nodes
    node_color_scheme="pastel", # Color scheme
    font_size=12,               # Font size
    rankdir="LR"                # Left-to-Right layout
)

# Create exporter with custom config
exporter = ASTExporter(config)

# Export with custom configuration
exporter.export(ast_data, "output/custom_ast.png", OutputFormat.PNG)
```

### Export to Multiple Formats

```python
# Export to multiple formats at once
formats = [OutputFormat.PNG, OutputFormat.SVG, OutputFormat.DOT, OutputFormat.JSON]
exporter.export_multiple_formats(ast_data, "output/ast", formats)

# Returns list of generated file paths
# ["output/ast.png", "output/ast.svg", "output/ast.dot", "output/ast.json"]
```

### Handling Large ASTs

```python
# Export large AST by chunking into manageable parts
exporter.export_large_ast(
    ast_data,
    "output/large_ast",
    format=OutputFormat.PNG,
    chunk_size=300  # Max nodes per chunk
)

# For ASTs with multiple contracts, each contract is exported separately
# Returns list of generated chunk files
```

### Factory Function

```python
from src.visualization.stellar.ast import create_ast_exporter

# Create exporter with custom configuration
exporter = create_ast_exporter(
    max_nodes=1000,
    max_depth=100,
    show_line_numbers=True,
    show_types=True
)

exporter.export(ast_data, "output/ast.png", OutputFormat.PNG)
```

### Loading AST from JSON

```python
from src.visualization.stellar.ast import load_ast_from_json, ASTExporter, OutputFormat

# Load AST from JSON file
ast_data = load_ast_from_json("path/to/ast.json")

# Export visualization
exporter = ASTExporter()
exporter.export(ast_data, "output/ast.png", OutputFormat.PNG)
```

## Output Formats

### PNG
Raster image format. Requires Graphviz to be installed. Best for documents and presentations.

### SVG
Vector image format. Requires Graphviz to be installed. Best for web and scalable graphics.

### DOT
Graphviz DOT format. Can be opened in Graphviz tools or converted to other formats manually.

### JSON
JSON format containing nodes and edges data. Useful for custom visualization or further processing.

## Visualization Features

### Node Types
- **Root**: Contract file (blue-gray box)
- **Contract**: Contract definition (light blue 3D box)
- **Function**: Function/method (purple ellipse)
- **Variable**: State variable (pink note)
- **Parameter**: Function parameter (yellow rounded box)
- **Struct**: Struct definition (green folder)
- **Field**: Struct field (yellow rounded box)
- **Enum**: Enum definition (red diamond)
- **Variant**: Enum variant (yellow rounded box)

### Edge Labels
- `contains`: Contract contains functions/variables
- `has`: Function has parameters
- `defines`: Contract defines structs/enums
- `field`: Struct has fields
- `variant`: Enum has variants
- `param`: Function has parameters

### Tooltips
Hover over nodes to see:
- Node type
- Line number (if enabled)
- Visibility (for variables/functions)
- Other metadata

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_depth` | int | 100 | Maximum depth to traverse |
| `max_nodes` | int | 1000 | Maximum number of nodes to render |
| `show_line_numbers` | bool | True | Show line numbers in tooltips |
| `show_types` | bool | True | Show type information |
| `collapse_similar` | bool | True | Collapse similar nodes for large ASTs |
| `node_color_scheme` | str | "pastel" | Color scheme for nodes |
| `edge_color` | str | "#555555" | Color for edges |
| `font_size` | int | 10 | Font size for labels |
| `rankdir` | str | "TB" | Layout direction (TB=Top-to-Bottom, LR=Left-to-Right) |

## Testing

Run the test suite:

```bash
python -m pytest src/visualization/stellar/ast/test_visualizer.py -v
```

Or using unittest:

```bash
python -m unittest src.visualization.stellar.ast.test_visualizer
```

## Integration with GasGuard

This visualization module integrates with the existing GasGuard AST parsing infrastructure:

1. Parse Soroban contract using the Rust parser in `libs/parsers/rust/src/lib.rs`
2. Convert to UnifiedAST format from `libs/ast/src/lib.rs`
3. Export to JSON if needed
4. Use this visualization module to generate graph exports

Example workflow:

```python
# Parse contract (using Rust parser)
# ast_data = RustParser.parse(source, file_path)

# Export visualization
from src.visualization.stellar.ast import ASTExporter, OutputFormat
exporter = ASTExporter()
exporter.export(ast_data.to_dict(), "output/ast.png", OutputFormat.PNG)
```

## Troubleshooting

### Graphviz not found
If you get an error about Graphviz not being available:
1. Install Graphviz from https://graphviz.org/download/
2. Ensure Graphviz is in your system PATH
3. Restart your terminal/IDE after installation

### Large AST rendering issues
For very large ASTs:
1. Reduce `max_nodes` in configuration
2. Use `export_large_ast()` with chunking
3. Export to JSON format instead of PNG/SVG

### Memory issues
If you encounter memory issues:
1. Reduce `max_nodes` limit
2. Use chunking for large contracts
3. Process contracts individually

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions are welcome! Please ensure:
- All tests pass
- Code follows existing style
- Documentation is updated
- Changes are backward compatible
