"""
Tests for AST Visualizer
"""

import unittest
import json
import os
import tempfile
from pathlib import Path

from .visualizer import ASTVisualizer, OutputFormat, VisualizationConfig
from .exporter import ASTExporter, load_ast_from_json, create_ast_exporter


class TestASTVisualizer(unittest.TestCase):
    """Test cases for ASTVisualizer"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.config = VisualizationConfig(
            max_nodes=100,
            max_depth=10,
            show_line_numbers=True,
            show_types=True
        )
        self.visualizer = ASTVisualizer(self.config)
        
        # Sample AST data
        self.sample_ast = {
            "language": "Rust",
            "source": "pub struct Contract;",
            "file_path": "test.rs",
            "contracts": [
                {
                    "name": "TestContract",
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
                    "state_variables": [
                        {
                            "name": "admin",
                            "type_name": "Address",
                            "visibility": "Public",
                            "is_constant": False,
                            "is_immutable": True,
                            "line_number": 5
                        }
                    ],
                    "line_number": 1
                }
            ],
            "structs": [
                {
                    "name": "Data",
                    "fields": [
                        {
                            "name": "value",
                            "type_name": "u64",
                            "visibility": "Public",
                            "is_constant": False,
                            "is_immutable": False,
                            "line_number": 15
                        }
                    ],
                    "line_number": 14
                }
            ],
            "enums": []
        }
    
    def test_visualize_creates_dot_format(self):
        """Test that visualize creates valid DOT format"""
        dot_output = self.visualizer.visualize(self.sample_ast)
        
        self.assertIn("digraph AST", dot_output)
        self.assertIn("node_", dot_output)
        self.assertIn("->", dot_output)
        self.assertIn("}", dot_output)
    
    def test_visualize_includes_contract(self):
        """Test that contract is included in visualization"""
        dot_output = self.visualizer.visualize(self.sample_ast)
        
        self.assertIn("TestContract", dot_output)
        self.assertIn("Contract:", dot_output)
    
    def test_visualize_includes_function(self):
        """Test that functions are included in visualization"""
        dot_output = self.visualizer.visualize(self.sample_ast)
        
        self.assertIn("initialize", dot_output)
        self.assertIn("fn", dot_output)
    
    def test_visualize_includes_struct(self):
        """Test that structs are included in visualization"""
        dot_output = self.visualizer.visualize(self.sample_ast)
        
        self.assertIn("Data", dot_output)
        self.assertIn("struct", dot_output)
    
    def test_to_json(self):
        """Test JSON export"""
        json_output = self.visualizer.to_json(self.sample_ast)
        
        data = json.loads(json_output)
        self.assertIn("nodes", data)
        self.assertIn("edges", data)
        self.assertIn("config", data)
        self.assertGreater(len(data["nodes"]), 0)
    
    def test_max_nodes_limit(self):
        """Test that max_nodes limit is respected"""
        limited_config = VisualizationConfig(max_nodes=5)
        limited_visualizer = ASTVisualizer(limited_config)
        
        dot_output = limited_visualizer.visualize(self.sample_ast)
        
        # Should have limited nodes in the actual graph
        self.assertLessEqual(len(limited_visualizer.nodes), 5)
    
    def test_show_line_numbers(self):
        """Test line number display"""
        config_with_lines = VisualizationConfig(show_line_numbers=True)
        visualizer_with_lines = ASTVisualizer(config_with_lines)
        
        dot_output = visualizer_with_lines.visualize(self.sample_ast)
        
        # Should include line information in tooltips
        self.assertIn("Line:", dot_output)
    
    def test_show_types(self):
        """Test type information display"""
        config_with_types = VisualizationConfig(show_types=True)
        visualizer_with_types = ASTVisualizer(config_with_types)
        
        dot_output = visualizer_with_types.visualize(self.sample_ast)
        
        # Should include type information
        self.assertIn("Address", dot_output)


class TestASTExporter(unittest.TestCase):
    """Test cases for ASTExporter"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.config = VisualizationConfig(max_nodes=100)
        self.exporter = ASTExporter(self.config)
        
        self.sample_ast = {
            "language": "Rust",
            "source": "pub struct Contract;",
            "file_path": "test.rs",
            "contracts": [
                {
                    "name": "TestContract",
                    "functions": [],
                    "state_variables": [],
                    "line_number": 1
                }
            ],
            "structs": [],
            "enums": []
        }
        
        # Create temporary directory for test outputs
        self.temp_dir = tempfile.mkdtemp()
    
    def tearDown(self):
        """Clean up test outputs"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_export_json(self):
        """Test JSON export"""
        output_path = os.path.join(self.temp_dir, "test_ast.json")
        
        result_path = self.exporter.export(
            self.sample_ast,
            output_path,
            OutputFormat.JSON
        )
        
        self.assertTrue(os.path.exists(result_path))
        self.assertTrue(result_path.endswith('.json'))
        
        # Verify content
        with open(result_path, 'r') as f:
            data = json.load(f)
            self.assertIn("nodes", data)
    
    def test_export_dot(self):
        """Test DOT export"""
        output_path = os.path.join(self.temp_dir, "test_ast.dot")
        
        result_path = self.exporter.export(
            self.sample_ast,
            output_path,
            OutputFormat.DOT
        )
        
        self.assertTrue(os.path.exists(result_path))
        self.assertTrue(result_path.endswith('.dot'))
        
        # Verify content
        with open(result_path, 'r') as f:
            content = f.read()
            self.assertIn("digraph AST", content)
    
    def test_export_creates_directory(self):
        """Test that export creates necessary directories"""
        output_path = os.path.join(
            self.temp_dir,
            "subdir",
            "nested",
            "test_ast.json"
        )
        
        result_path = self.exporter.export(
            self.sample_ast,
            output_path,
            OutputFormat.JSON
        )
        
        self.assertTrue(os.path.exists(result_path))
        self.assertTrue(os.path.exists(os.path.dirname(result_path)))
    
    def test_export_multiple_formats(self):
        """Test exporting to multiple formats"""
        base_path = os.path.join(self.temp_dir, "test_ast")
        
        formats = [OutputFormat.JSON, OutputFormat.DOT]
        result_paths = self.exporter.export_multiple_formats(
            self.sample_ast,
            base_path,
            formats
        )
        
        self.assertEqual(len(result_paths), 2)
        for path in result_paths:
            self.assertTrue(os.path.exists(path))
    
    def test_export_large_ast_chunking(self):
        """Test large AST chunking"""
        # Create AST with multiple contracts
        large_ast = {
            "language": "Rust",
            "source": "multiple contracts",
            "file_path": "large.rs",
            "contracts": [
                {"name": f"Contract{i}", "functions": [], "state_variables": [], "line_number": i}
                for i in range(3)
            ],
            "structs": [],
            "enums": []
        }
        
        base_path = os.path.join(self.temp_dir, "large_ast")
        result_paths = self.exporter.export_large_ast(
            large_ast,
            base_path,
            OutputFormat.JSON,
            chunk_size=10
        )
        
        # Should create multiple files
        self.assertGreater(len(result_paths), 1)
        for path in result_paths:
            self.assertTrue(os.path.exists(path))


class TestLoadASTFromJSON(unittest.TestCase):
    """Test cases for load_ast_from_json utility"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.sample_ast = {
            "language": "Rust",
            "contracts": [],
            "structs": [],
            "enums": []
        }
    
    def tearDown(self):
        """Clean up test outputs"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_load_ast_from_json(self):
        """Test loading AST from JSON file"""
        json_path = os.path.join(self.temp_dir, "ast.json")
        
        with open(json_path, 'w') as f:
            json.dump(self.sample_ast, f)
        
        loaded_ast = load_ast_from_json(json_path)
        
        self.assertEqual(loaded_ast["language"], "Rust")
        self.assertEqual(loaded_ast["contracts"], [])


class TestCreateASTExporter(unittest.TestCase):
    """Test cases for create_ast_exporter factory function"""
    
    def test_create_ast_exporter_with_defaults(self):
        """Test creating exporter with default configuration"""
        exporter = create_ast_exporter()
        
        self.assertIsInstance(exporter, ASTExporter)
        self.assertEqual(exporter.config.max_nodes, 1000)
    
    def test_create_ast_exporter_with_custom_config(self):
        """Test creating exporter with custom configuration"""
        exporter = create_ast_exporter(
            max_nodes=500,
            max_depth=50,
            show_line_numbers=False
        )
        
        self.assertIsInstance(exporter, ASTExporter)
        self.assertEqual(exporter.config.max_nodes, 500)
        self.assertEqual(exporter.config.max_depth, 50)
        self.assertFalse(exporter.config.show_line_numbers)


if __name__ == '__main__':
    unittest.main()
