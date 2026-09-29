; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
(
  (comment)? @comment
  (class_declaration
    name: (_) @name
  ) @definition
)

(
  (comment)? @comment
  (function_declaration
    name: (_) @name
    parameters: (_) @parameters
  ) @definition
)

(
  (comment)? @comment
  (method_definition
    name: (_) @name
    parameters: (_) @parameters
  ) @definition
)

(
  (comment)? @comment
  (interface_declaration
    name: (_) @name) @definition
) 
