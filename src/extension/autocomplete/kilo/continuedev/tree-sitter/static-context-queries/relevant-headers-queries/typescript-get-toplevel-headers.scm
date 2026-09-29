; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
;; Match top-level `var`, `let`, or `const` declarations
(lexical_declaration
  (variable_declarator
    name: (identifier) @top.var.name
    type: (type_annotation
            (_) @top.var.type))) @top.var.decl

(variable_declaration
  (variable_declarator
    name: (identifier) @top.var.name
    type: (type_annotation
            (_) @top.var.type))) @top.var.decl

;; Match function declarations
(function_declaration
  name: (identifier) @top.fn.name
  parameters: (formal_parameters
    (required_parameter
      pattern: (identifier) @top.fn.param.name
      type: (type_annotation (_) @top.fn.param.type)))*

  return_type: (type_annotation (_) @top.fn.type)?) @top.fn.decl
