; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
;; defun/defsubst
(function_definition name: (symbol) @name.definition.function) @definition.function

;; Treat macros as function definitions for the sake of TAGS.
(macro_definition name: (symbol) @name.definition.function) @definition.function

;; Match function calls
(list (symbol) @name.reference.function) @reference.function
