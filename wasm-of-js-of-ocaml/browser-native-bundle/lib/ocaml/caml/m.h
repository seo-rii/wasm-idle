/* runtime/caml/m.h.  Generated from m.h.in by configure.  */
/**************************************************************************/
/*                                                                        */
/*                                 OCaml                                  */
/*                                                                        */
/*             Xavier Leroy, projet Cristal, INRIA Rocquencourt           */
/*                                                                        */
/*   Copyright 1996 Institut National de Recherche en Informatique et     */
/*     en Automatique.                                                    */
/*                                                                        */
/*   All rights reserved.  This file is distributed under the terms of    */
/*   the GNU Lesser General Public License version 2.1, with the          */
/*   special exception on linking described in the file LICENSE.          */
/*                                                                        */
/**************************************************************************/

/* Machine-related configuration */

#define ARCH_SIXTYFOUR 1

/* Define ARCH_SIXTYFOUR if the processor has a natural word size of 64 bits.
   That is, sizeof(char *) = 8.
   Otherwise, leave ARCH_SIXTYFOUR undefined.
   This assumes sizeof(char *) = 4. */

/* #undef ARCH_BIG_ENDIAN */

/* Define ARCH_BIG_ENDIAN if the processor is big endian (the most
   significant byte of an integer stored in memory comes first).
   Leave ARCH_BIG_ENDIAN undefined if the processor is little-endian
   (the least significant byte comes first).
*/

/* #undef ARCH_ALIGN_DOUBLE */

/* Define ARCH_ALIGN_DOUBLE if the processor requires doubles to be
   doubleword-aligned. Leave ARCH_ALIGN_DOUBLE undefined if the processor
   supports word-aligned doubles. */

#define HAS_ARCH_CODE32 1

/* Define HAS_ARCH_CODE32 if, on a 64-bit machine, code pointers fit
   in 32 bits, i.e. the code segment resides in the low 4G of the
   addressing space.
   HAS_ARCH_CODE32 is ignored on 32-bit machines. */

#define SIZEOF_INT 4
#define SIZEOF_LONG 8
#define SIZEOF_PTR 8
#define SIZEOF_SHORT 2
#define SIZEOF_LONGLONG 8

/* Define SIZEOF_INT, SIZEOF_LONG, SIZEOF_PTR, SIZEOF_SHORT and
   SIZEOF_LONGLONG to the sizes in bytes of the C types "int", "long",
   "char *", "short" and "long long" respectively. */

/* #undef ARCH_ALIGN_INT64 */

/* Define ARCH_ALIGN_INT64 if the processor requires 64-bit integers to be
   doubleword-aligned. Leave ARCH_ALIGN_INT64 undefined if the processor
   supports word-aligned 64-bit integers.  Leave undefined if
   64-bit integers are not supported. */

#define HEADER_RESERVED_BITS 0

#define ASM_CFI_SUPPORTED 1

#define ASM_SIZE_TYPE_DIRECTIVES 1

/* Define ASM_SIZE_TYPE_DIRECTIVES when the ".size" and ".type" assembler
   directives can be used */

/* #undef WITH_FRAME_POINTERS */

#define NO_NAKED_POINTERS 1

/* #undef CAML_WITH_FPIC */

#define CAML_SAFE_STRING 1

#define FLAT_FLOAT_ARRAY 1

#define FUNCTION_SECTIONS 1

/* #undef SUPPORTS_ALIGNED_ATTRIBUTE */

#define SUPPORTS_TREE_VECTORIZE 1

/* #undef USE_MMAP_MAP_STACK */

#define WITH_NONEXECSTACK_NOTE 1

/* Define WITH_NONEXECSTACK_NOTE when an explicit ".note.GNU-stack" section
   is to be added to indicate the stack should not be executable */
