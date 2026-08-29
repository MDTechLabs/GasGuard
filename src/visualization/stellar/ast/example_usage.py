"""
Example usage of the Soroban AST Visualization Exporter

This script demonstrates how to use the AST visualization exporter
to generate visual representations of parsed AST structures.
"""

import json
from src.visualization.stellar.ast import ASTExporter, OutputFormat, create_ast_exporter


def example_basic_usage():
    """Basic usage example"""
    print("=== Basic Usage Example ===\n")
    
    # Sample AST data (typically from parsed Soroban contract)
    ast_data = {
        "language": "Rust",
        "source": "#[contract(name=\"MyContract\")]\npub struct MyContract;\n\n#[contractimpl]\nimpl MyContract {\n    pub fn initialize(env: Env, admin: Address) {\n        // initialization logic\n    }\n}",
        "file_path": "contract.rs",
        "contracts": [
            {
                "name": "MyContract",
                "functions": [
                    {
                        "name": "initialize",
                        "params": [
                            {"name": "env", "type_name": "Env"},
                            {"name": "admin", "type_name": "Address"}
                        ],
                        "return_type": None,
                        "visibility": "Public",
                        "decorators": [],
                        "is_constructor": True,
                        "is_external": True,
                        "is_payable": False,
                        "line_number": 5,
                        "body_raw": "{\n        // initialization logic\n    }"
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
    
    # Export to different formats
    print("Exporting AST visualization...")
    
    try:
        # Export to JSON (doesn't require Graphviz)
        json_path = exporter.export(ast_data, "output/example_ast.json", OutputFormat.JSON)
        print(f"✓ JSON export: {json_path}")
        
        # Export to DOT (doesn't require Graphviz)
        dot_path = exporter.export(ast_data, "output/example_ast.dot", OutputFormat.DOT)
        print(f"✓ DOT export: {dot_path}")
        
        # Export to PNG (requires Graphviz)
        try:
            png_path = exporter.export(ast_data, "output/example_ast.png", OutputFormat.PNG)
            print(f"✓ PNG export: {png_path}")
        except RuntimeError as e:
            print(f"✗ PNG export failed (Graphviz not available): {e}")
        
        # Export to SVG (requires Graphviz)
        try:
            svg_path = exporter.export(ast_data, "output/example_ast.svg", OutputFormat.SVG)
            print(f"✓ SVG export: {svg_path}")
        except RuntimeError as e:
            print(f"✗ SVG export failed (Graphviz not available): {e}")
            
    except Exception as e:
        print(f"Error during export: {e}")


def example_custom_configuration():
    """Example with custom configuration"""
    print("\n=== Custom Configuration Example ===\n")
    
    from src.visualization.stellar.ast import VisualizationConfig
    
    # Create custom configuration
    config = VisualizationConfig(
        max_nodes=500,
        max_depth=50,
        show_line_numbers=True,
        show_types=True,
        font_size=12,
        rankdir="LR"  # Left-to-Right layout
    )
    
    # Create exporter with custom config
    exporter = ASTExporter(config)
    
    ast_data = {
        "language": "Rust",
        "source": "pub struct Contract;",
        "file_path": "contract.rs",
        "contracts": [
            {
                "name": "CustomContract",
                "functions": [
                    {
                        "name": "custom_function",
                        "params": [{"name": "param1", "type_name": "u64"}],
                        "return_type": "Result<(), Error>",
                        "visibility": "Public",
                        "decorators": [],
                        "is_constructor": False,
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
    
    print("Exporting with custom configuration...")
    try:
        json_path = exporter.export(ast_data, "output/custom_ast.json", OutputFormat.JSON)
        print(f"✓ Custom JSON export: {json_path}")
    except Exception as e:
        print(f"Error: {e}")


def example_multiple_formats():
    """Example exporting to multiple formats at once"""
    print("\n=== Multiple Formats Example ===\n")
    
    exporter = ASTExporter()
    
    ast_data = {
        "language": "Rust",
        "source": "pub struct Contract;",
        "file_path": "contract.rs",
        "contracts": [
            {
                "name": "MultiFormatContract",
                "functions": [],
                "state_variables": [],
                "line_number": 1
            }
        ],
        "structs": [],
        "enums": []
    }
    
    print("Exporting to multiple formats simultaneously...")
    formats = [OutputFormat.JSON, OutputFormat.DOT]
    
    try:
        result_paths = exporter.export_multiple_formats(
            ast_data,
            "output/multi_format_ast",
            formats
        )
        
        for path in result_paths:
            print(f"✓ Exported: {path}")
    except Exception as e:
        print(f"Error: {e}")


def example_large_ast():
    """Example handling large AST structures"""
    print("\n=== Large AST Handling Example ===\n")
    
    exporter = ASTExporter()
    
    # Create AST with multiple contracts
    large_ast = {
        "language": "Rust",
        "source": "multiple contracts",
        "file_path": "large_contract.rs",
        "contracts": [
            {
                "name": f"Contract{i}",
                "functions": [],
                "state_variables": [],
                "line_number": i * 10
            }
            for i in range(5)
        ],
        "structs": [],
        "enums": []
    }
    
    print("Exporting large AST with chunking...")
    try:
        result_paths = exporter.export_large_ast(
            large_ast,
            "output/large_ast",
            format=OutputFormat.JSON,
            chunk_size=10
        )
        
        print(f"✓ Generated {len(result_paths)} chunk files:")
        for path in result_paths:
            print(f"  - {path}")
    except Exception as e:
        print(f"Error: {e}")


def example_factory_function():
    """Example using factory function"""
    print("\n=== Factory Function Example ===\n")
    
    # Create exporter using factory function
    exporter = create_ast_exporter(
        max_nodes=1000,
        max_depth=100,
        show_line_numbers=True,
        show_types=True
    )
    
    ast_data = {
        "language": "Rust",
        "source": "pub struct Contract;",
        "file_path": "contract.rs",
        "contracts": [
            {
                "name": "FactoryContract",
                "functions": [],
                "state_variables": [],
                "line_number": 1
            }
        ],
        "structs": [],
        "enums": []
    }
    
    print("Exporting using factory-created exporter...")
    try:
        json_path = exporter.export(ast_data, "output/factory_ast.json", OutputFormat.JSON)
        print(f"✓ Factory export: {json_path}")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    # Create output directory
    import os
    os.makedirs("output", exist_ok=True)
    
    # Run examples
    example_basic_usage()
    example_custom_configuration()
    example_multiple_formats()
    example_large_ast()
    example_factory_function()
    
    print("\n=== All examples completed ===")
    print("Check the 'output' directory for generated files.")
