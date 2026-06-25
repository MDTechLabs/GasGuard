"""
AST Visualizer for Soroban Contracts

This module provides functionality to visualize AST structures using graphviz.
"""

from enum import Enum
from typing import Dict, List, Optional, Any
import json
from dataclasses import dataclass, field


class OutputFormat(Enum):
    """Supported output formats for AST visualization"""
    PNG = "png"
    SVG = "svg"
    DOT = "dot"
    JSON = "json"


@dataclass
class VisualizationConfig:
    """Configuration for AST visualization"""
    max_depth: int = 100  # Maximum depth to traverse (for large ASTs)
    max_nodes: int = 1000  # Maximum number of nodes to render
    show_line_numbers: bool = True
    show_types: bool = True
    collapse_similar: bool = True  # Collapse similar nodes for large ASTs
    node_color_scheme: str = "pastel"
    edge_color: str = "#555555"
    font_size: int = 10
    rankdir: str = "TB"  # Top-to-Bottom or Left-to-Right (LR)


class ASTVisualizer:
    """
    Visualizer for AST structures from Soroban contracts.
    
    Converts AST nodes into graph representations using graphviz.
    """
    
    def __init__(self, config: Optional[VisualizationConfig] = None):
        """
        Initialize the AST visualizer.
        
        Args:
            config: Visualization configuration options
        """
        self.config = config or VisualizationConfig()
        self.node_counter = 0
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, Any]] = []
        
    def visualize(self, ast_data: Dict[str, Any]) -> str:
        """
        Convert AST data to DOT format graph representation.
        
        Args:
            ast_data: Parsed AST data (UnifiedAST structure)
            
        Returns:
            DOT format string
        """
        self.node_counter = 0
        self.nodes = {}
        self.edges = []
        
        # Create root node
        root_id = self._create_node(
            name=ast_data.get("language", "Unknown"),
            label=f"Contract: {ast_data.get('file_path', 'unknown')}",
            node_type="root"
        )
        
        # Process contracts
        for contract in ast_data.get("contracts", []):
            contract_id = self._process_contract(contract, root_id)
            self._add_edge(root_id, contract_id, "contains")
        
        # Process structs
        for struct in ast_data.get("structs", []):
            struct_id = self._process_struct(struct, root_id)
            self._add_edge(root_id, struct_id, "defines")
        
        # Process enums
        for enum in ast_data.get("enums", []):
            enum_id = self._process_enum(enum, root_id)
            self._add_edge(root_id, enum_id, "defines")
        
        return self._generate_dot()
    
    def _process_contract(self, contract: Dict[str, Any], parent_id: str) -> str:
        """Process a contract node and its children"""
        contract_id = self._create_node(
            name=contract.get("name", "UnknownContract"),
            label=f"Contract: {contract.get('name', 'Unknown')}",
            node_type="contract",
            metadata={"line": contract.get("line_number", 0)}
        )
        
        # Process functions
        for func in contract.get("functions", []):
            func_id = self._process_function(func, contract_id)
            self._add_edge(contract_id, func_id, "has")
        
        # Process state variables
        for var in contract.get("state_variables", []):
            var_id = self._process_variable(var, contract_id)
            self._add_edge(contract_id, var_id, "has")
        
        return contract_id
    
    def _process_function(self, func: Dict[str, Any], parent_id: str) -> str:
        """Process a function node"""
        visibility = func.get("visibility", "Unknown")
        func_label = f"fn {func.get('name', 'unknown')}()"
        
        if self.config.show_types and func.get("return_type"):
            func_label += f" -> {func.get('return_type')}"
        
        func_id = self._create_node(
            name=func.get("name", "unknown"),
            label=func_label,
            node_type="function",
            metadata={
                "visibility": visibility,
                "line": func.get("line_number", 0),
                "external": func.get("is_external", False),
                "payable": func.get("is_payable", False)
            }
        )
        
        # Process parameters
        for param in func.get("params", []):
            param_id = self._create_node(
                name=param.get("name", "param"),
                label=f"{param.get('name', 'unknown')}: {param.get('type_name', 'unknown')}",
                node_type="parameter"
            )
            self._add_edge(func_id, param_id, "param")
        
        return func_id
    
    def _process_variable(self, var: Dict[str, Any], parent_id: str) -> str:
        """Process a variable node"""
        var_label = f"{var.get('name', 'unknown')}: {var.get('type_name', 'unknown')}"
        
        if var.get("is_constant"):
            var_label = f"const {var_label}"
        elif var.get("is_immutable"):
            var_label = f"immutable {var_label}"
        
        var_id = self._create_node(
            name=var.get("name", "unknown"),
            label=var_label,
            node_type="variable",
            metadata={
                "visibility": var.get("visibility", "Unknown"),
                "line": var.get("line_number", 0)
            }
        )
        
        return var_id
    
    def _process_struct(self, struct: Dict[str, Any], parent_id: str) -> str:
        """Process a struct node"""
        struct_id = self._create_node(
            name=struct.get("name", "UnknownStruct"),
            label=f"struct {struct.get('name', 'Unknown')}",
            node_type="struct",
            metadata={"line": struct.get("line_number", 0)}
        )
        
        # Process fields
        for field in struct.get("fields", []):
            field_id = self._create_node(
                name=field.get("name", "field"),
                label=f"{field.get('name', 'unknown')}: {field.get('type_name', 'unknown')}",
                node_type="field"
            )
            self._add_edge(struct_id, field_id, "field")
        
        return struct_id
    
    def _process_enum(self, enum: Dict[str, Any], parent_id: str) -> str:
        """Process an enum node"""
        enum_id = self._create_node(
            name=enum.get("name", "UnknownEnum"),
            label=f"enum {enum.get('name', 'Unknown')}",
            node_type="enum",
            metadata={"line": enum.get("line_number", 0)}
        )
        
        # Process variants
        for variant in enum.get("variants", []):
            variant_id = self._create_node(
                name=variant,
                label=variant,
                node_type="variant"
            )
            self._add_edge(enum_id, variant_id, "variant")
        
        return enum_id
    
    def _create_node(self, name: str, label: str, node_type: str, 
                    metadata: Optional[Dict[str, Any]] = None) -> str:
        """Create a node in the graph"""
        # Check if we've exceeded max nodes before creating
        if self.node_counter >= self.config.max_nodes:
            return f"node_limit_exceeded"
        
        node_id = f"node_{self.node_counter}"
        self.node_counter += 1
        
        self.nodes[node_id] = {
            "id": node_id,
            "name": name,
            "label": label,
            "type": node_type,
            "metadata": metadata or {}
        }
        
        return node_id
    
    def _add_edge(self, from_id: str, to_id: str, label: str) -> None:
        """Add an edge between two nodes"""
        if len(self.edges) >= self.config.max_nodes:
            return
            
        self.edges.append({
            "from": from_id,
            "to": to_id,
            "label": label
        })
    
    def _generate_dot(self) -> str:
        """Generate DOT format string from nodes and edges"""
        dot_lines = [
            "digraph AST {",
            f"  rankdir={self.config.rankdir};",
            f"  node [fontname=\"Arial\", fontsize={self.config.font_size}];",
            f"  edge [fontname=\"Arial\", fontsize={self.config.font_size - 1}, color=\"{self.config.edge_color}\"];",
            ""
        ]
        
        # Add nodes with styling based on type
        for node_id, node in self.nodes.items():
            style = self._get_node_style(node["type"])
            tooltip = self._get_node_tooltip(node)
            
            dot_lines.append(
                f'  {node_id} [label="{node["label"]}", {style}, tooltip="{tooltip}"];'
            )
        
        dot_lines.append("")
        
        # Add edges
        for edge in self.edges:
            dot_lines.append(
                f'  {edge["from"]} -> {edge["to"]} [label="{edge["label"]}"];'
            )
        
        dot_lines.append("}")
        
        return "\n".join(dot_lines)
    
    def _get_node_style(self, node_type: str) -> str:
        """Get styling attributes for a node based on its type"""
        styles = {
            "root": 'shape="box", style="filled", fillcolor="#e0e0e0", color="#333333"',
            "contract": 'shape="box3d", style="filled", fillcolor="#a8d8ea", color="#333333"',
            "function": 'shape="ellipse", style="filled", fillcolor="#aa96da", color="#333333"',
            "variable": 'shape="note", style="filled", fillcolor="#fcbad3", color="#333333"',
            "parameter": 'shape="box", style="rounded,filled", fillcolor="#ffffd1", color="#333333"',
            "struct": 'shape="folder", style="filled", fillcolor="#95e1d3", color="#333333"',
            "field": 'shape="box", style="rounded,filled", fillcolor="#ffffd1", color="#333333"',
            "enum": 'shape="diamond", style="filled", fillcolor="#f38181", color="#333333"',
            "variant": 'shape="box", style="rounded,filled", fillcolor="#ffffd1", color="#333333"'
        }
        
        return styles.get(node_type, 'shape="ellipse", style="filled", fillcolor="#ffffff"')
    
    def _get_node_tooltip(self, node: Dict[str, Any]) -> str:
        """Generate tooltip text for a node"""
        tooltip_parts = [f"Type: {node['type']}"]
        
        if self.config.show_line_numbers and "line" in node.get("metadata", {}):
            tooltip_parts.append(f"Line: {node['metadata']['line']}")
        
        if "visibility" in node.get("metadata", {}):
            tooltip_parts.append(f"Visibility: {node['metadata']['visibility']}")
        
        return "\\n".join(tooltip_parts)
    
    def to_json(self, ast_data: Dict[str, Any]) -> str:
        """
        Convert AST data to JSON format for visualization.
        
        Args:
            ast_data: Parsed AST data
            
        Returns:
            JSON string with nodes and edges
        """
        self.visualize(ast_data)
        
        return json.dumps({
            "nodes": self.nodes,
            "edges": self.edges,
            "config": {
                "max_depth": self.config.max_depth,
                "max_nodes": self.config.max_nodes,
                "show_line_numbers": self.config.show_line_numbers,
                "show_types": self.config.show_types
            }
        }, indent=2)
