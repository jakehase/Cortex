import hashlib
import importlib.util
import os
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name(
    "durable-qualification-publication.py"
)
SPEC = importlib.util.spec_from_file_location(
    "durable_qualification_publication",
    MODULE_PATH,
)
publication = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publication)


class DurableQualificationPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="clos-durable-qualification-"
        )
        self.root = pathlib.Path(self.temporary.name)
        self.root.chmod(0o700)
        self.source = self.root / "source"
        self.destination = self.root / "destination"
        self.source.mkdir(mode=0o700)
        self.destination.mkdir(mode=0o700)

    def tearDown(self):
        self.temporary.cleanup()

    def make_artifact(self, label, kind):
        staging = self.source / f"{label}.stage"
        final_parent = self.source if kind == "immutable-tree" else self.destination
        final = final_parent / f"{label}.final"
        if kind == "file":
            staging.write_bytes(f"authenticated:{label}\n".encode("utf-8"))
            staging.chmod(0o600)
        else:
            staging.mkdir(mode=0o700)
            nested = staging / "nested"
            nested.mkdir(mode=0o700)
            payload = nested / "payload.json"
            payload.write_bytes(f'{{"label":"{label}"}}\n'.encode("utf-8"))
            payload.chmod(0o444)
            nested.chmod(0o555)
            staging.chmod(0o555)
        digest = publication.publication_digest(staging, kind)
        return staging, final, digest

    def test_every_launcher_rename_recovers_after_process_and_power_crash_cuts(self):
        for label, kind in [
            ("local-checkout", "immutable-tree"),
            ("remote-checkout", "immutable-tree"),
            ("remote-plan", "file"),
            ("local-job", "file"),
            ("remote-job", "file"),
        ]:
            with self.subTest(label=label, crash_state="renamed"):
                staging, final, digest = self.make_artifact(label, kind)

                def crash(phase):
                    if phase == "after_rename":
                        raise RuntimeError(f"crash:{label}:{phase}")

                with self.assertRaisesRegex(RuntimeError, f"crash:{label}"):
                    publication.publish(
                        str(staging),
                        str(final),
                        kind,
                        digest,
                        crash_injector=crash,
                    )
                self.assertFalse(os.path.lexists(staging))
                self.assertTrue(os.path.lexists(final))
                recovered = publication.publish(
                    str(staging),
                    str(final),
                    kind,
                    digest,
                )
                self.assertEqual(recovered["status"], "adopted")
                self.assertEqual(
                    publication.publication_digest(final, kind),
                    digest,
                )

            with self.subTest(label=label, crash_state="rename-rolled-back"):
                rollback_label = f"{label}-rollback"
                staging, final, digest = self.make_artifact(rollback_label, kind)

                def crash(phase):
                    if phase == "after_rename":
                        raise RuntimeError(f"crash:{rollback_label}:{phase}")

                with self.assertRaisesRegex(RuntimeError, f"crash:{rollback_label}"):
                    publication.publish(
                        str(staging),
                        str(final),
                        kind,
                        digest,
                        crash_injector=crash,
                    )
                os.rename(final, staging)
                recovered = publication.publish(
                    str(staging),
                    str(final),
                    kind,
                    digest,
                )
                self.assertEqual(recovered["status"], "published")
                self.assertFalse(os.path.lexists(staging))
                self.assertTrue(os.path.lexists(final))

    def test_publication_fsyncs_staged_tree_and_rename_parents(self):
        staging, final, digest = self.make_artifact(
            "parent-durability",
            "immutable-tree",
        )
        observed = []
        original_fsync = publication.os.fsync

        def recording_fsync(descriptor):
            try:
                observed.append(
                    pathlib.Path(
                        os.readlink(f"/proc/self/fd/{descriptor}")
                    ).resolve()
                )
            except OSError:
                pass
            original_fsync(descriptor)

        publication.os.fsync = recording_fsync
        try:
            publication.publish(
                str(staging),
                str(final),
                "immutable-tree",
                digest,
            )
        finally:
            publication.os.fsync = original_fsync
        self.assertIn(self.source, observed)
        self.assertIn(staging / "nested", observed)
        self.assertIn(staging, observed)

        file_staging, file_final, file_digest = self.make_artifact(
            "distinct-parents",
            "file",
        )
        observed.clear()
        publication.os.fsync = recording_fsync
        try:
            publication.publish(
                str(file_staging),
                str(file_final),
                "file",
                file_digest,
            )
        finally:
            publication.os.fsync = original_fsync
        self.assertIn(self.source, observed)
        self.assertIn(self.destination, observed)

    def test_recursive_tree_walk_pins_directories_and_rejects_named_removal(self):
        staging, _final, _expected_digest = self.make_artifact(
            "recursive-directory-swap",
            "immutable-tree",
        )
        nested = staging / "nested"
        displaced = staging / ".displaced-nested"
        original_hash = publication._hash_open_file
        attacked = False

        def swap_named_directory(descriptor):
            nonlocal attacked
            if not attacked:
                attacked = True
                staging.chmod(0o755)
                nested.rename(displaced)
            return original_hash(descriptor)

        publication._hash_open_file = swap_named_directory
        try:
            with self.assertRaisesRegex(
                publication.PublicationError,
                "directory changed|root changed",
            ):
                publication.publication_digest(staging, "immutable-tree")
        finally:
            publication._hash_open_file = original_hash
        self.assertTrue(attacked)
        self.assertTrue(displaced.exists())

    def test_adoption_rejects_changed_bytes_symlinks_and_external_hard_links(self):
        staging, final, digest = self.make_artifact("changed", "file")
        publication.publish(str(staging), str(final), "file", digest)
        final.write_bytes(b"substituted\n")
        with self.assertRaisesRegex(
            publication.PublicationError,
            "differs from authenticated bytes",
        ):
            publication.publish(str(staging), str(final), "file", digest)

        symlink = self.source / "symlink.stage"
        symlink.symlink_to(final)
        with self.assertRaises(OSError):
            publication.publication_digest(symlink, "file")

        hardlink_source = self.source / "hardlink.stage"
        hardlink_source.write_bytes(b"authenticated hardlink\n")
        hardlink_source.chmod(0o600)
        outside = self.root / "outside-link"
        os.link(hardlink_source, outside)
        with self.assertRaisesRegex(
            publication.PublicationError,
            "unsafe",
        ):
            publication.publication_digest(hardlink_source, "file")
        outside.unlink()

    def test_publication_pins_safe_ancestors_and_rejects_parent_name_swaps(self):
        unsafe = self.root / "unsafe"
        unsafe.mkdir(mode=0o700)
        unsafe_source = unsafe / "source"
        unsafe_destination = unsafe / "destination"
        unsafe_source.mkdir(mode=0o700)
        unsafe_destination.mkdir(mode=0o700)
        unsafe_stage = unsafe_source / "artifact.stage"
        unsafe_final = unsafe_destination / "artifact.final"
        unsafe_stage.write_bytes(b"unsafe-ancestor\n")
        unsafe_stage.chmod(0o600)
        unsafe_digest = publication.publication_digest(unsafe_stage, "file")
        unsafe.chmod(0o770)
        with self.assertRaisesRegex(
            publication.PublicationError,
            "ancestor is unsafe",
        ):
            publication.publish(
                str(unsafe_stage),
                str(unsafe_final),
                "file",
                unsafe_digest,
            )
        unsafe.chmod(0o700)

        movable = self.root / "movable"
        movable_source = movable / "source"
        movable_destination = movable / "destination"
        movable.mkdir(mode=0o700)
        movable_source.mkdir(mode=0o700)
        movable_destination.mkdir(mode=0o700)
        movable_stage = movable_source / "artifact.stage"
        movable_final = movable_destination / "artifact.final"
        movable_stage.write_bytes(b"descriptor-pinned\n")
        movable_stage.chmod(0o600)
        movable_digest = publication.publication_digest(movable_stage, "file")
        displaced = self.root / "movable-displaced"
        swapped = False

        def swap_parent(phase):
            nonlocal swapped
            if phase != "after_parent_pin" or swapped:
                return
            swapped = True
            movable.rename(displaced)
            movable.mkdir(mode=0o700)
            (movable / "source").mkdir(mode=0o700)
            (movable / "destination").mkdir(mode=0o700)

        with self.assertRaisesRegex(
            publication.PublicationError,
            "parent identity changed",
        ):
            publication.publish(
                str(movable_stage),
                str(movable_final),
                "file",
                movable_digest,
                crash_injector=swap_parent,
            )
        self.assertTrue(swapped)
        self.assertFalse(movable_final.exists())
        self.assertEqual(
            (displaced / "destination" / "artifact.final").read_bytes(),
            b"descriptor-pinned\n",
        )

    def test_descriptor_supervised_state_root_remains_a_pinned_publication_anchor(self):
        descriptor = os.open(
            self.root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            staging = pathlib.Path(
                f"/proc/self/fd/{descriptor}/source/descriptor.stage"
            )
            final = pathlib.Path(
                f"/proc/self/fd/{descriptor}/destination/descriptor.final"
            )
            staging.write_bytes(b"descriptor-supervised\n")
            staging.chmod(0o600)
            digest = publication.publication_digest(staging, "file")
            result = publication.publish(
                str(staging),
                str(final),
                "file",
                digest,
            )
            self.assertEqual(result["status"], "published")
            self.assertEqual(
                (self.destination / "descriptor.final").read_bytes(),
                b"descriptor-supervised\n",
            )
        finally:
            os.close(descriptor)

    def test_explicit_read_only_group_contract_is_exact_and_descriptor_pinned(self):
        alternate_groups = [
            group for group in os.getgroups() if group != os.getegid()
        ]
        alternate_gid = alternate_groups[0] if alternate_groups else 100
        staging = self.source / "remote-job.stage"
        final = self.destination / "remote-job.final"
        payload = b"authenticated:remote-worker-job\n"
        staging.write_bytes(payload)
        staging.chmod(0o440)
        os.chown(staging, os.geteuid(), alternate_gid)
        digest = hashlib.sha256(payload).hexdigest()

        with self.assertRaisesRegex(
            publication.PublicationError,
            "file is unsafe",
        ):
            publication.publish(
                str(staging),
                str(final),
                "file",
                digest,
            )

        result = publication.publish(
            str(staging),
            str(final),
            "file",
            digest,
            expected_file_metadata=(os.geteuid(), alternate_gid, 0o440),
        )
        self.assertEqual(result["status"], "published")
        observed = final.stat()
        self.assertEqual(observed.st_uid, os.geteuid())
        self.assertEqual(observed.st_gid, alternate_gid)
        self.assertEqual(observed.st_mode & 0o777, 0o440)
        self.assertEqual(final.read_bytes(), payload)

        with self.assertRaisesRegex(
            publication.PublicationError,
            "file is unsafe",
        ):
            publication.publish(
                str(staging),
                str(final),
                "file",
                digest,
                expected_file_metadata=(os.geteuid(), os.getegid(), 0o440),
            )
        for weakened in [
            (os.geteuid() + 1, alternate_gid, 0o440),
            (os.geteuid(), alternate_gid, 0o460),
            (os.geteuid(), alternate_gid, 0o040),
        ]:
            with self.subTest(weakened=weakened):
                with self.assertRaisesRegex(
                    publication.PublicationError,
                    "weakens publisher ownership or write protection",
                ):
                    publication.publish(
                        str(staging),
                        str(final),
                        "file",
                        digest,
                        expected_file_metadata=weakened,
                    )


if __name__ == "__main__":
    unittest.main()
