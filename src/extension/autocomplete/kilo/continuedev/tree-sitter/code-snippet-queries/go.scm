; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
(
  (comment)* @comment
  .
  (function_declaration
    name: (identifier) @name.definition.function
    parameters: (_) @parameters
    result: (_)? @return_type
  ) @definition.function
  (#strip! @comment "^//\\s*")
  (#set-adjacent! @comment @definition.function)
)

(
  (comment)* @comment
  .
  (method_declaration
    receiver: (_) @receiver
    name: (field_identifier) @name.definition.method
    parameters: (_) @parameters
    result: (_)? @return_type
  ) @definition.method
  (#strip! @comment "^//\\s*")
  (#set-adjacent! @comment @definition.method)
)

(type_spec
  name: (type_identifier) @name.definition.type) @definition.type