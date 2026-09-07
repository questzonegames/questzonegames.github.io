#!/usr/bin/env perl
# ============================================================================
# Quest Zone — Anagram Quest dictionary builder
# ============================================================================
# Regenerates games/anagram-quest/data/dictionary.txt from licensed,
# redistributable source word lists (see scripts/SOURCES.md for exactly
# which ones, and why each is legally safe to embed), rather than hand-
# editing that file directly.
#
# Written in Perl, not Node, because this repo is a plain static site with
# no JS build tooling anywhere (no package.json/node_modules), and — more
# to the point — Node.js is not actually installed in the environment this
# was first built and run in, while Perl ships with Git for Windows/Cygwin
# out of the box. If a future contributor has Node and prefers a JS
# rewrite, the algorithm here (parse Hunspell .dic/.aff, expand affixes,
# union with the existing base dictionary, apply manual overrides, filter
# to 4-9 letters) ports directly — nothing here is Perl-specific in spirit.
#
# Usage (from the repo root):
#   perl scripts/build-anagram-dictionary.pl
#
# Reads:
#   games/anagram-quest/data/dictionary.txt        (existing ENABLE1 base —
#                                                    kept as an input, not
#                                                    replaced wholesale)
#   scripts/dictionary-sources/en-GB/index.dic      (SCOWL-derived British
#   scripts/dictionary-sources/en-GB/index.aff       Hunspell dictionary —
#                                                    see SOURCES.md)
#   games/anagram-quest/data/manual-valid-words.json
#   games/anagram-quest/data/manual-invalid-words.json
#
# Writes:
#   games/anagram-quest/data/dictionary.txt  (overwritten — same format:
#                                              lowercase, one word per
#                                              line, 4-9 letters only)
#
# Prints a full statistics report — per-length counts, sources, duplicates
# removed, manual adds/blocks — every run.
# ============================================================================
use strict;
use warnings;
use utf8;
use JSON::PP;

binmode(STDOUT, ':encoding(UTF-8)');

my $BASE_DICT  = 'games/anagram-quest/data/dictionary.txt';
my $GB_DIC     = 'scripts/dictionary-sources/en-GB/index.dic';
my $GB_AFF     = 'scripts/dictionary-sources/en-GB/index.aff';
my $MANUAL_OK  = 'games/anagram-quest/data/manual-valid-words.json';
my $MANUAL_BAD = 'games/anagram-quest/data/manual-invalid-words.json';
my $MIN_LEN    = 4;
my $MAX_LEN    = 9;

# ---------------------------------------------------------------------------
# 1. Load the existing ENABLE1-derived base dictionary as-is. It's already
#    lowercase and already filtered to 4-9 letters (see the audit this
#    script's commit documents), so every entry in it is used unchanged.
# ---------------------------------------------------------------------------
sub load_wordlist {
  my ($path) = @_;
  open(my $fh, '<:encoding(UTF-8)', $path) or die "Could not open $path: $!";
  my %set;
  while (my $line = <$fh>) {
    $line =~ s/[\r\n]+$//;
    next unless length $line;
    $set{lc $line} = 1;
  }
  close $fh;
  return \%set;
}
my $base_words = load_wordlist($BASE_DICT);
my $base_count = scalar keys %$base_words;

# ---------------------------------------------------------------------------
# 2. Parse the Hunspell .aff file: just the PFX/SFX blocks we need to expand
#    plurals, verb conjugations, comparatives/superlatives, etc. Hunspell's
#    condition syntax ("." = any char, "[^aeiou]" = char class) is already
#    valid as a Perl regex fragment, so no translation is needed beyond
#    anchoring it at the right end of the word.
#
#    Rule line format: "SFX <flag> <strip> <add> <condition>"
#    (PFX is identical but applies at the start of the word instead of the
#    end.) `add` may carry a trailing "/FLAGS" for continuation classes —
#    stripped here, since this script only expands one affix level deep
#    (covers the overwhelming majority of real inflections; chained
#    prefix+suffix combinations are a rare enough edge case for a word
#    game that they're not worth the added complexity).
# ---------------------------------------------------------------------------
sub parse_aff {
  my ($path) = @_;
  open(my $fh, '<:encoding(UTF-8)', $path) or die "Could not open $path: $!";
  my %rules; # flag -> { type => 'SFX'|'PFX', list => [ [strip, add, condition], ... ] }
  while (my $line = <$fh>) {
    # Header line: "SFX flag cross_product(Y/N) count" — exactly 4 fields.
    if ($line =~ /^(SFX|PFX)\s+(\S+)\s+[YN]\s+\d+\s*$/) {
      $rules{$2} = { type => $1, list => [] };
      next;
    }
    # Rule line: "SFX flag strip add condition [morphological...]" — 5+ fields.
    next unless $line =~ /^(SFX|PFX)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/;
    my ($type, $flag, $strip, $add, $cond) = ($1, $2, $3, $4, $5);
    $rules{$flag} ||= { type => $type, list => [] }; # in case a rule line is ever seen before its own header
    push @{ $rules{$flag}{list} }, [$strip, $add, $cond];
  }
  close $fh;
  return \%rules;
}
my $aff_rules = parse_aff($GB_AFF);

# ---------------------------------------------------------------------------
# 3. Parse the .dic file and expand every entry through its flags' affix
#    rules. Proper nouns are excluded here by construction: Hunspell
#    dictionaries capitalise proper-noun entries (London, Britain, ...) so
#    they can still be spell-checked, and lowercase common words otherwise —
#    so skipping any entry that doesn't start lowercase is a principled,
#    data-driven way to apply this project's "no proper names" rule rather
#    than a hand-maintained blocklist.
# ---------------------------------------------------------------------------
sub expand_dic {
  my ($path, $rules) = @_;
  open(my $fh, '<:encoding(UTF-8)', $path) or die "Could not open $path: $!";
  my $first = <$fh>; # word count header line — not needed, just skip it
  my %surface;
  my $base_entries = 0;
  while (my $line = <$fh>) {
    $line =~ s/[\r\n]+$//;
    next unless length $line;
    $line =~ s/\t.*$//; # strip morphological data after a tab, if any
    my ($word, $flagstr) = split m{/}, $line, 2;
    next unless defined $word && length $word;
    next if $word =~ /[^a-zA-Z]/;      # apostrophes, digits, hyphens etc. out
    next if $word =~ /^[A-Z]/;          # capitalised entry = proper noun
    $base_entries++;
    my $lc = lc $word;
    $surface{$lc} = 1;
    next unless defined $flagstr;
    for my $flag (split //, $flagstr) {
      my $rule = $rules->{$flag} or next;
      for my $r (@{ $rule->{list} }) {
        my ($strip, $add, $cond) = @$r;
        $add =~ s{/.*$}{}; # drop continuation flags on the replacement text
        my $matched =
          $cond eq '.' ? 1 :
          $rule->{type} eq 'SFX' ? ($word =~ /$cond$/) :
                                    ($word =~ /^$cond/);
        next unless $matched;
        my $derived;
        if ($rule->{type} eq 'SFX') {
          my $stem = $word;
          $stem = substr($stem, 0, length($stem) - length($strip)) unless $strip eq '0';
          $derived = $stem . $add;
        } else {
          my $stem = $word;
          $stem = substr($stem, length($strip)) unless $strip eq '0';
          $derived = $add . $stem;
        }
        next if $derived =~ /[^a-zA-Z]/;
        $surface{lc $derived} = 1;
      }
    }
  }
  close $fh;
  return (\%surface, $base_entries);
}
my ($gb_words, $gb_base_entries) = expand_dic($GB_DIC, $aff_rules);
my $gb_expanded_count = scalar keys %$gb_words;

# ---------------------------------------------------------------------------
# 4. Manual overrides — load (creating empty files on first run if absent
#    so the JSON structure always exists and survives future rebuilds).
# ---------------------------------------------------------------------------
sub load_json_list {
  my ($path) = @_;
  unless (-e $path) {
    open(my $out, '>:encoding(UTF-8)', $path) or die "Could not create $path: $!";
    print $out "[]\n";
    close $out;
  }
  open(my $fh, '<:encoding(UTF-8)', $path) or die "Could not open $path: $!";
  local $/;
  my $json_text = <$fh>;
  close $fh;
  my $data = decode_json($json_text || '[]');
  return [ map { lc $_ } @$data ];
}
my $manual_valid   = load_json_list($MANUAL_OK);
my $manual_invalid = load_json_list($MANUAL_BAD);
my %manual_invalid_set = map { $_ => 1 } @$manual_invalid;

# ---------------------------------------------------------------------------
# 5. Union everything, then apply policy: 4-9 letters, alphabetic only,
#    manual-invalid removed, manual-valid always added back in last (so a
#    manual override can never be silently lost to a filter above it).
# ---------------------------------------------------------------------------
my %union;
$union{$_} = 1 for keys %$base_words;
my $new_from_gb = 0;
for my $w (keys %$gb_words) {
  $new_from_gb++ unless exists $union{$w};
  $union{$w} = 1;
}

my %final;
my $rejected_by_length = 0;
my $rejected_by_manual = 0;
for my $w (keys %union) {
  next if $w =~ /[^a-z]/;
  if (length($w) < $MIN_LEN || length($w) > $MAX_LEN) { $rejected_by_length++; next; }
  if ($manual_invalid_set{$w}) { $rejected_by_manual++; next; }
  $final{$w} = 1;
}
my $manual_added = 0;
for my $w (@$manual_valid) {
  next if $w =~ /[^a-z]/ || length($w) < $MIN_LEN || length($w) > $MAX_LEN;
  $manual_added++ unless exists $final{$w};
  $final{$w} = 1;
}

# ---------------------------------------------------------------------------
# 6. Write the production dictionary — same format as before (sorted,
#    lowercase, one word per line, trailing newline).
# ---------------------------------------------------------------------------
my @sorted = sort keys %final;
open(my $out, '>:encoding(UTF-8)', $BASE_DICT) or die "Could not write $BASE_DICT: $!";
print $out "$_\n" for @sorted;
close $out;

# ---------------------------------------------------------------------------
# 7. Statistics report.
# ---------------------------------------------------------------------------
my %by_len;
$by_len{length $_}++ for @sorted;

print "=" x 78, "\n";
print "Anagram Quest dictionary rebuild\n";
print "=" x 78, "\n";
print "Sources used:\n";
print "  - ENABLE1 base (existing dictionary.txt)  — Public Domain (Alan Beale / ENABLE project)\n";
print "  - SCOWL-derived en-GB Hunspell dictionary  — MIT-like (Kevin Atkinson / SCOWL),\n";
print "    itself folding in ENABLE, 12Dicts, UKACD and MWords — see scripts/SOURCES.md\n";
print "    (vendored copy: scripts/dictionary-sources/en-GB/, wooorm/dictionaries mirror)\n";
print "\n";
print "ENABLE1 base words loaded:            $base_count\n";
print "en-GB .dic base entries parsed:       $gb_base_entries\n";
print "en-GB words after affix expansion:    $gb_expanded_count\n";
print "New words contributed by en-GB:       $new_from_gb\n";
print "Rejected (outside $MIN_LEN-$MAX_LEN letters):     $rejected_by_length\n";
print "Rejected (manual-invalid-words.json): $rejected_by_manual\n";
print "Manually added (manual-valid-words.json): $manual_added", (@$manual_valid ? " (" . join(', ', @$manual_valid) . ")" : ""), "\n";
print "\n";
print "Final word counts by length:\n";
my $total = 0;
for my $len ($MIN_LEN..$MAX_LEN) {
  my $c = $by_len{$len} || 0;
  $total += $c;
  printf "  %d letters: %d\n", $len, $c;
}
print "  TOTAL: $total\n";
print "=" x 78, "\n";
