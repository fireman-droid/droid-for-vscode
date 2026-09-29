; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
(function_definition declarator: (function_declarator (identifier) @name)) @definition.function

(struct_specifier name: (type_identifier) @name.definition.class body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name.definition.class)) @definition.class

(type_definition declarator: (type_identifier) @name ) @definition

(enum_specifier name: (type_identifier) @name.definition.type) @definition.type
