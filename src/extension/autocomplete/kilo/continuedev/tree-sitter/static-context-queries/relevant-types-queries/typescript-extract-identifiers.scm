; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
;; Capture the type alias name (left-hand side)
; (type_alias_declaration
;   name: (type_identifier) @type.name)

;; Capture all identifiers on the right-hand side (value), recursively
; (type_alias_declaration
;   value: (_) @type.value)

;; Match all identifiers inside the type value — deeply nested
(type_identifier) @type.identifier
