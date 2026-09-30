; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
(class_declaration
 name: (identifier) @name.definition.class
 ) @definition.class

(class_declaration
   bases: (base_list (_) @name.reference.class)
 ) @reference.class

(interface_declaration
 name: (identifier) @name.definition.interface
 ) @definition.interface

(interface_declaration
 bases: (base_list (_) @name.reference.interface)
 ) @reference.interface

(method_declaration
 name: (identifier) @name.definition.method
 ) @definition.method

(namespace_declaration
 name: (identifier) @name.definition.module
) @definition.module
