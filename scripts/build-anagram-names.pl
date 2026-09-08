#!/usr/bin/env perl
# ============================================================================
# Quest Zone — Anagram Quest first-name list builder
# ============================================================================
# Regenerates games/anagram-quest/data/first-names.txt — a SEPARATE set from
# the main dictionary.txt, used only to let recognised human first names
# count as valid answers in Rounds 1-4 (never Round 5 — see anagram-quest.js's
# isValidAnagramQuestWord(word, allowNames), which is the only place that
# reads this file's Set, and is only ever called with allowNames=true when
# state.currentRound !== 5).
#
# Written in Perl for the same reason as build-anagram-dictionary.pl (no
# Node/Python in this environment; see that file's own header) — the
# algorithm (filter a name-database CSV to GB/US-attested entries, apply
# manual overrides, filter to 4-9 letters) ports directly to any language.
#
# Usage (from the repo root):
#   perl scripts/build-anagram-names.pl
#
# Reads:
#   scripts/name-sources/firstname-database/firstnames.csv  (see SOURCES.md)
#   games/anagram-quest/data/manual-valid-names.json
#   games/anagram-quest/data/manual-invalid-names.json
#
# Writes:
#   games/anagram-quest/data/first-names.txt  (overwritten — lowercase, one
#                                               name per line, 4-9 letters)
#
# Prints a full statistics report every run.
# ============================================================================
use strict;
use warnings;
use utf8;
use JSON::PP;

binmode(STDOUT, ':encoding(UTF-8)');

my $CSV        = 'scripts/name-sources/firstname-database/firstnames.csv';
my $MANUAL_OK  = 'games/anagram-quest/data/manual-valid-names.json';
my $MANUAL_BAD = 'games/anagram-quest/data/manual-invalid-names.json';
my $OUT        = 'games/anagram-quest/data/first-names.txt';
my $MIN_LEN    = 4;
my $MAX_LEN    = 9;

sub load_json_list {
  my ($path) = @_;
  return {} unless -e $path;
  open(my $fh, '<:encoding(UTF-8)', $path) or die "Cannot read $path: $!\n";
  local $/;
  my $json = <$fh>;
  close $fh;
  my $list = decode_json($json);
  my %set;
  $set{lc($_)} = 1 for @$list;
  return \%set;
}

# ---------------------------------------------------------------------------
# 1. Parse firstnames.csv — semicolon-delimited, header row, columns:
#    name;gender;Great Britain;Ireland;U.S.A.;...(other countries).
#    A non-empty value in the "Great Britain" (col 2) or "U.S.A." (col 4)
#    column means the name is attested there (any frequency, however rare —
#    breadth over just the top-N most popular names, since the dataset's own
#    documentation describes it as prepared "with utmost care" and checked
#    by native speakers per country, not a scrape). Pure first names only —
#    this dataset is a first-name database by construction, no surnames.
# ---------------------------------------------------------------------------
open(my $fh, '<:encoding(UTF-8)', $CSV) or die "Cannot read $CSV: $!\n";
my $header = <$fh>; # discard header row
my %fromCsv;
my $csvRows = 0;
while (my $line = <$fh>) {
  chomp $line;
  next if $line eq '';
  my @cols = split(/;/, $line, -1);
  my $name = $cols[0];
  my $gb   = $cols[2];
  my $us   = $cols[4];
  next unless (defined $gb && $gb ne '') || (defined $us && $us ne '');
  next unless defined $name && $name =~ /^[A-Za-z]+$/; # pure alphabetic only
  my $len = length($name);
  next if $len < $MIN_LEN || $len > $MAX_LEN;
  $fromCsv{lc($name)} = 1;
  $csvRows++;
}
close $fh;

# ---------------------------------------------------------------------------
# 2. Apply manual overrides — invalid removed first, then valid always added
#    back (manual-valid-names.json wins even over a later CSV update, same
#    rule as the main dictionary build).
# ---------------------------------------------------------------------------
my $manualOk  = load_json_list($MANUAL_OK);
my $manualBad = load_json_list($MANUAL_BAD);

my %final = %fromCsv;
my $removedByManualBad = 0;
for my $bad (keys %$manualBad) {
  if (exists $final{$bad}) { delete $final{$bad}; $removedByManualBad++; }
}
my $addedByManualOk = 0;
for my $ok (keys %$manualOk) {
  next if length($ok) < $MIN_LEN || length($ok) > $MAX_LEN;
  $addedByManualOk++ unless exists $final{$ok};
  $final{$ok} = 1;
}

# ---------------------------------------------------------------------------
# 3. Write output, sorted, one per line.
# ---------------------------------------------------------------------------
my @sorted = sort keys %final;
open(my $out, '>:encoding(UTF-8)', $OUT) or die "Cannot write $OUT: $!\n";
print $out "$_\n" for @sorted;
close $out;

# ---------------------------------------------------------------------------
# 4. Statistics report.
# ---------------------------------------------------------------------------
my %byLen;
$byLen{length($_)}++ for @sorted;
print "=" x 70, "\n";
print "Anagram Quest first-name list build complete\n";
print "=" x 70, "\n";
print "Source CSV rows read (GB/US-attested, 4-9 letters): $csvRows\n";
print "Manual valid names applied (manual-valid-names.json): $addedByManualOk added\n";
print "Manual invalid names applied (manual-invalid-names.json): $removedByManualBad removed\n";
print "-" x 70, "\n";
print "Final first-name count: " . scalar(@sorted) . "\n";
print "By length:\n";
for my $len ($MIN_LEN .. $MAX_LEN) {
  printf "  %d letters: %d\n", $len, ($byLen{$len} || 0);
}
print "-" x 70, "\n";
for my $spot (qw(james harry hannah luke bill santa jones elvis drake adele)) {
  print "  spot-check '$spot': " . (exists $final{$spot} ? "INCLUDED" : "not included") . "\n";
}
print "=" x 70, "\n";
print "Wrote $OUT\n";
